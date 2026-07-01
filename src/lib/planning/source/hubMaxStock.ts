import 'server-only';
import { unstable_cache } from 'next/cache';
import type { HubId } from '@/types/planning';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

// Per-SKU, per-hub maximum stock caps (sub-project B3). Visibility/alert only.
// Keyed sku_base → { hub → max }. Empty when unset (no cap → never flagged).

export interface HubMaxStockRow {
  sku_base: string;
  hub_id: string;
  max_qty: number;
  updated_by: string | null;
  updated_at: string;
}

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];

const fetchRows = unstable_cache(
  async (): Promise<HubMaxStockRow[]> => readFleetTable<HubMaxStockRow>(FLEET_TABLES.hubMaxStock),
  ['hub-max-stock-rows'],
  { revalidate: 300, tags: ['hub-max-stock'] },
);

/** sku_base → per-hub cap. Only hubs with a configured cap appear. */
export async function fetchHubMaxStock(): Promise<Map<string, Partial<Record<HubId, number>>>> {
  try {
    const rows = await fetchRows();
    const map = new Map<string, Partial<Record<HubId, number>>>();
    for (const r of rows) {
      if (!HUBS.includes(r.hub_id as HubId)) continue;
      const entry = map.get(r.sku_base) ?? {};
      entry[r.hub_id as HubId] = Number(r.max_qty) || 0;
      map.set(r.sku_base, entry);
    }
    return map;
  } catch (e) {
    console.error('[fetchHubMaxStock]', e instanceof Error ? e.message : e);
    return new Map();
  }
}

/** Hubs where current on-hand exceeds the configured cap (over-cap alert). */
export function overCapHubs(
  byHub: Record<HubId, number>,
  caps: Partial<Record<HubId, number>> | undefined,
): HubId[] {
  if (!caps) return [];
  return HUBS.filter((h) => caps[h] != null && byHub[h] > (caps[h] as number));
}
