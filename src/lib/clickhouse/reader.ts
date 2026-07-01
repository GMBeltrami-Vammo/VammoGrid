import 'server-only';
import { unstable_cache } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// Direct ClickHouse HTTP interface — the Metabase REST fallback was retired (it
// cost ~2-3x the round-trips: a 2000-row native-query cap forced batching, e.g.
// the forecast alone needed a DISTINCT + ~15 queries; see decisions.MD #8/#9).
// Dependency-free (plain fetch), SERVER ONLY. Tables are referenced fully-
// qualified (e.g. `analytics.int_inventory_current`, `dev.sop_predictions_daily`).
//
// Originally read-only; write support (chInsert/chExecute) was added when the
// `fleet.*` config/state tables moved here from Supabase (decisions.MD #11) —
// mutable data lives in `dev.fleet_*` as ReplacingMergeTree(updated_at) + a
// soft-delete flag (ClickHouse has no row-level UPDATE/DELETE at OLTP speed),
// with every change also appended to `dev.fleet_audit_log`. See lib/clickhouse/fleet.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

// Treat the literal strings "null"/"undefined" (an easy CLI-prompt typo — e.g.
// typing "null" into `vercel env add` meaning "leave unset") and blank/whitespace
// values the same as unset. Without this, CLICKHOUSE_DATABASE="null" gets sent to
// ClickHouse as a real (nonexistent) database name → every query 404s with
// "Database `null` does not exist", which is a genuinely-happened production bug.
function envOrDefault(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v && v !== 'null' && v !== 'undefined' ? v : fallback;
}

// CLICKHOUSE_HOST must be a full URL (e.g. https://<host>:8443 for ClickHouse
// Cloud). A bare hostname — the easy mistake, since ClickHouse Cloud's connection
// panel often shows just the host — makes `new URL()` throw an opaque
// ERR_INVALID_URL. Normalize instead of crashing: assume https + ClickHouse
// Cloud's default HTTPS port (8443) when no scheme is present.
function resolveClickhouseUrl(host: string): URL {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`;
  try {
    const url = new URL(withScheme);
    if (!url.port) url.port = '8443';
    return url;
  } catch {
    throw new Error(
      `CLICKHOUSE_HOST is not a valid URL: "${host}". Expected e.g. https://<host>:8443.`,
    );
  }
}

async function clickhouseQuery<T = Row>(sql: string): Promise<T[]> {
  const host = process.env.CLICKHOUSE_HOST;
  if (!host) {
    throw new Error(
      'No analytics backend configured. Set CLICKHOUSE_HOST/USER/PASSWORD/DATABASE.',
    );
  }
  const user = envOrDefault(process.env.CLICKHOUSE_USER, 'default');
  const password = envOrDefault(process.env.CLICKHOUSE_PASSWORD, '');
  const database = envOrDefault(process.env.CLICKHOUSE_DATABASE, 'default');

  // ClickHouse HTTP interface: append FORMAT JSONEachRow → newline-delimited JSON.
  const url = resolveClickhouseUrl(host);
  url.searchParams.set('database', database);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: `${sql}\nFORMAT JSONEachRow`,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Run DDL or a write statement (CREATE TABLE, INSERT) with no result rows expected.
 * Unlike clickhouseQuery, does NOT append `FORMAT JSONEachRow` — that's only valid
 * for statements that return rows.
 */
async function clickhouseExecute(sql: string): Promise<void> {
  const host = process.env.CLICKHOUSE_HOST;
  if (!host) {
    throw new Error(
      'No analytics backend configured. Set CLICKHOUSE_HOST/USER/PASSWORD/DATABASE.',
    );
  }
  const user = envOrDefault(process.env.CLICKHOUSE_USER, 'default');
  const password = envOrDefault(process.env.CLICKHOUSE_PASSWORD, '');
  const database = envOrDefault(process.env.CLICKHOUSE_DATABASE, 'default');

  const url = resolveClickhouseUrl(host);
  url.searchParams.set('database', database);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
    },
    body: sql,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ClickHouse statement failed: ${res.status} ${await res.text()}`);
  }
}

/** Run DDL (CREATE TABLE IF NOT EXISTS, etc). Statement text is always an internal
 *  constant — never build DDL from user input. */
export function chExecute(sql: string): Promise<void> {
  return clickhouseExecute(sql);
}

/**
 * Insert rows into a ClickHouse table. `table` must be an internal constant (never
 * user input — it's concatenated directly into the SQL prefix). Row VALUES are safe
 * from injection: they travel as a JSONEachRow body parsed by ClickHouse's JSON
 * decoder, never as interpolated SQL text, so untrusted field values (notes, names)
 * can never be interpreted as SQL syntax.
 */
export async function chInsert(table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  return clickhouseExecute(`INSERT INTO ${table} FORMAT JSONEachRow\n${body}`);
}

/** Whether ClickHouse is configured (for the data-source health panel). */
export function activeBackendKind(): 'clickhouse' | 'none' {
  return process.env.CLICKHOUSE_HOST ? 'clickhouse' : 'none';
}

/** Run a read-only native SQL query against the analytics warehouse. */
export function chQuery<T = Row>(sql: string): Promise<T[]> {
  return clickhouseQuery<T>(sql);
}

/**
 * Cached read: same as chQuery but persists the rows in Next's data cache across
 * requests and users (the warehouse data is identical for everyone and changes
 * slowly). Keyed by the SQL string; expires after `revalidateSeconds` or when one
 * of `tags` is passed to revalidateTag(). Errors are NOT cached (they throw, so the
 * next request retries). Rows are plain serializable objects — never cache Maps.
 */
export function cachedChQuery<T = Row>(
  sql: string,
  revalidateSeconds: number,
  tags: string[],
): Promise<T[]> {
  return unstable_cache(() => chQuery<T>(sql), ['ch-query', sql], {
    revalidate: revalidateSeconds,
    tags,
  })() as Promise<T[]>;
}
