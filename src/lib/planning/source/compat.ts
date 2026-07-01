import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { BIKE_MODELS } from '@/types';
import { toSkuBase } from '../sku';

// Bike-model compatibility from ClickHouse dev.fleet_part_compat (formerly Supabase
// fleet.part_compat; see decisions.MD #11) — the 9-model matrix; the warehouse
// only knows the coarse BIKE/BATTERY/BOX category. Keyed by sku_base. Returns an
// empty map if ClickHouse is unconfigured — the filter then just won't constrain
// by model.

// Compatibility matrix rarely changes → cache rows for 1h across requests. Also the
// read path for the client-side useCompat hook (via /api/fleet/part-compat) — the
// hook can no longer query ClickHouse directly from the browser.
export const fetchCompatRows = unstable_cache(
  async (): Promise<Record<string, unknown>[]> => readFleetTable(FLEET_TABLES.partCompat),
  ['part-compat-rows'],
  { revalidate: 86400, tags: ['compat'] }, // matrix rarely changes → cache 1 day
);

export async function fetchCompatModels(): Promise<Map<string, Set<string>>> {
  try {
    const rows = await fetchCompatRows();
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      const base = toSkuBase(String(row.sku ?? ''));
      if (!base) continue;
      const set = map.get(base) ?? new Set<string>();
      for (const m of BIKE_MODELS) if (row[m] === true) set.add(m);
      map.set(base, set);
    }
    return map;
  } catch (e) {
    console.error('[fetchCompatModels]', e instanceof Error ? e.message : e);
    return new Map();
  }
}
