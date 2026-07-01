import 'server-only';
import { unstable_cache } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// Read-only analytics access. Direct ClickHouse HTTP interface — the Metabase REST
// fallback was retired (it cost ~2-3x the round-trips: a 2000-row native-query cap
// forced batching, e.g. the forecast alone needed a DISTINCT + ~15 queries; see
// decisions.MD #8/#9). Dependency-free (plain fetch), SERVER ONLY. Every query is
// read-only; nothing here ever writes. Tables are referenced fully-qualified
// (e.g. `analytics.int_inventory_current`, `dev.sop_predictions_daily`).
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

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
  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const database = process.env.CLICKHOUSE_DATABASE ?? 'default';

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
