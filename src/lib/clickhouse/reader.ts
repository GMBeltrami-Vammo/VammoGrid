import 'server-only';
import { unstable_cache } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// Read-only analytics access. Per the plan: prefer a DIRECT ClickHouse connection
// when CLICKHOUSE_* env is set; otherwise fall back to running the same native SQL
// through Metabase's REST dataset endpoint with the existing METABASE_API_KEY.
//
// Both paths are dependency-free (plain fetch) and SERVER ONLY. Every query is
// read-only; nothing here ever writes. Tables are referenced fully-qualified
// (e.g. `analytics.int_inventory_current`, `dev.sop_predictions_daily`).
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

interface Backend {
  kind: 'clickhouse' | 'metabase';
  query<T = Row>(sql: string): Promise<T[]>;
}

function clickhouseBackend(): Backend | null {
  const host = process.env.CLICKHOUSE_HOST;
  if (!host) return null;
  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const database = process.env.CLICKHOUSE_DATABASE ?? 'default';

  return {
    kind: 'clickhouse',
    async query<T = Row>(sql: string): Promise<T[]> {
      // ClickHouse HTTP interface: append FORMAT JSONEachRow → newline-delimited JSON.
      const url = new URL(host);
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
    },
  };
}

function metabaseBackend(): Backend | null {
  const url = process.env.METABASE_URL;
  const key = process.env.METABASE_API_KEY;
  if (!url || !key) return null;
  // Vammo Replicated (ClickHouse) database id in Metabase.
  const databaseId = Number(process.env.METABASE_CH_DATABASE_ID) || 137;

  return {
    kind: 'metabase',
    async query<T = Row>(sql: string): Promise<T[]> {
      const res = await fetch(`${url}/api/dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({
          database: databaseId,
          type: 'native',
          native: { query: sql },
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Metabase dataset query failed: ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as {
        data?: { rows?: unknown[][]; cols?: { name: string }[] };
        error?: string;
      };
      if (json.error) throw new Error(`Metabase dataset error: ${json.error}`);
      const rows = json.data?.rows ?? [];
      const cols = (json.data?.cols ?? []).map((c) => c.name);
      return rows.map((r) => {
        const obj: Row = {};
        cols.forEach((name, idx) => {
          obj[name] = r[idx];
        });
        return obj as unknown as T;
      });
    },
  };
}

let cached: Backend | null | undefined;

function backend(): Backend {
  if (cached === undefined) {
    cached = clickhouseBackend() ?? metabaseBackend() ?? null;
  }
  if (!cached) {
    throw new Error(
      'No analytics backend configured. Set CLICKHOUSE_* or METABASE_URL + METABASE_API_KEY.',
    );
  }
  return cached;
}

/** Which backend will be used (for the data-source health panel). */
export function activeBackendKind(): 'clickhouse' | 'metabase' | 'none' {
  try {
    return backend().kind;
  } catch {
    return 'none';
  }
}

/** Run a read-only native SQL query against the analytics warehouse. */
export function chQuery<T = Row>(sql: string): Promise<T[]> {
  return backend().query<T>(sql);
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
