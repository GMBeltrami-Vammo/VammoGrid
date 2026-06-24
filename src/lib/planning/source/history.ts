import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, todayUtc } from '../dates';
import type { HubId } from '@/types/planning';

// Per-hub + global historical on-hand from Supabase fleet.piece_stock_hub (the daily
// per-hub snapshot, keyed by sku_name + hub_id + snapshot_date). This is the real
// per-hub history (the warehouse mart only keeps network totals), so the projection
// chart can show true per-hub history (D-30) before the projection.

export interface HistoryPoint {
  date: string;
  stock: number;
}

export interface StockHistory {
  global: HistoryPoint[];
  byHub: Record<HubId, HistoryPoint[]>;
}

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];

const emptyHistory = (): StockHistory => ({
  global: [],
  byHub: { osasco: [], mooca: [], sbc: [] },
});

function toSeries(m: Map<string, number>): HistoryPoint[] {
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, stock]) => ({ date, stock: Math.round(stock) }));
}

/** Historical on-hand for a SKU (matched by item name) over the last `days`. */
export async function fetchStockHistory(skuName: string, days = 30): Promise<StockHistory> {
  if (!skuName) return emptyHistory();
  try {
    const supabase = createServerSupabase();
    const cutoff = addDays(todayUtc(), -Math.abs(days));
    const { data, error } = await supabase
      .schema('fleet')
      .from('piece_stock_hub')
      .select('snapshot_date,hub_id,qty_available')
      .eq('sku_name', skuName)
      .gte('snapshot_date', cutoff)
      .order('snapshot_date', { ascending: true });
    if (error || !data) return emptyHistory();

    const byHubMap: Record<HubId, Map<string, number>> = {
      osasco: new Map(),
      mooca: new Map(),
      sbc: new Map(),
    };
    const globalByDate = new Map<string, number>();

    for (const r of data as { snapshot_date: string; hub_id: string; qty_available: number }[]) {
      const date = String(r.snapshot_date).slice(0, 10);
      const hub = r.hub_id as HubId;
      const qty = Number(r.qty_available) || 0;
      if (byHubMap[hub]) byHubMap[hub].set(date, (byHubMap[hub].get(date) ?? 0) + qty);
      globalByDate.set(date, (globalByDate.get(date) ?? 0) + qty);
    }

    return {
      global: toSeries(globalByDate),
      byHub: {
        osasco: toSeries(byHubMap.osasco),
        mooca: toSeries(byHubMap.mooca),
        sbc: toSeries(byHubMap.sbc),
      },
    };
  } catch {
    return emptyHistory();
  }
}
