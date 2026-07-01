import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

// The default visible SKU universe (sub-project A). Reads dev.fleet_sku_scope and
// returns the set of active sku_bases. When the table is empty/unconfigured the
// set is empty — callers MUST treat an empty set as "no scope defined → show
// everything" (fail-open), so the app stays usable before the scope is seeded and
// never silently hides the whole catalog on a read error.

export interface ScopeRow {
  sku_base: string;
  active: boolean;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
}

const fetchScopeRows = unstable_cache(
  async (): Promise<ScopeRow[]> => readFleetTable<ScopeRow>(FLEET_TABLES.skuScope),
  ['sku-scope-rows'],
  { revalidate: 300, tags: ['sku-scope'] },
);

/** Set of active-scope sku_bases. Empty = no scope defined (fail-open → show all). */
export async function fetchActiveScope(): Promise<Set<string>> {
  try {
    const rows = await fetchScopeRows();
    return new Set(rows.filter((r) => r.active).map((r) => r.sku_base));
  } catch (e) {
    console.error('[fetchActiveScope]', e instanceof Error ? e.message : e);
    return new Set();
  }
}

/** All scope rows (active + inactive) for the scope-manager UI. */
export async function fetchAllScopeRows(): Promise<ScopeRow[]> {
  try {
    return await fetchScopeRows();
  } catch (e) {
    console.error('[fetchAllScopeRows]', e instanceof Error ? e.message : e);
    return [];
  }
}
