import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { chQuery } from '@/lib/clickhouse/reader';
import { HUB_BY_LOCATION, HUB_LOCATION_IDS } from '@/constants/planningHubs';
import { addDays, todayUtc } from '../dates';
import type { HubId } from '@/types/planning';

// Historical on-hand (last `days` days) per hub + global.
//
// Primary: IMS ledger (ClickHouse). Reconstructs daily stock by starting from
// today's live on-hand and subtracting cumulative net-deltas going backwards.
// net_delta(day) = Σ(led.delta) for all STORAGE movements at hub locations.
//
// Fallback: Supabase fleet.piece_stock_hub (legacy daily snapshot cron; empty
// on most environments, kept for backwards compat).

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

interface LedgerDeltaRow {
  dt: string;
  location_id: string | number;
  net_delta: string | number;
}

export async function fetchStockHistory(
  skuName: string,
  days = 30,
  currentByHub?: Record<HubId, number>,
): Promise<StockHistory> {
  if (!skuName) return emptyHistory();

  // Supabase fleet.piece_stock_hub is the primary source — populated by the daily
  // cron at /api/inventory/snapshot. Use it when it has data for this SKU.
  const supabaseResult = await fetchHistoryFromSupabase(skuName, days);
  if (supabaseResult.global.length > 0) return supabaseResult;

  // Fallback: reconstruct from the IMS ledger (ClickHouse) when the Supabase
  // snapshot table is empty (e.g. new environments, before cron has run).
  if (currentByHub) {
    try {
      return await fetchHistoryFromLedger(skuName, days, currentByHub);
    } catch {
      // ledger unavailable — return empty
    }
  }

  return emptyHistory();
}

async function fetchHistoryFromLedger(
  skuName: string,
  days: number,
  currentByHub: Record<HubId, number>,
): Promise<StockHistory> {
  const safeName = skuName.replace(/'/g, "''");
  const sql = `
SELECT
  toDate(led.created_at) AS dt,
  loc.location_id,
  sum(toFloat64(led.delta)) AS net_delta
FROM analytics.stg_ims_r__ledger led
JOIN analytics.stg_ims_r__inventory inv ON inv.inventory_id = led.inventory_id
JOIN analytics.stg_ims_r__deposit dep ON dep.deposit_id = inv.deposit_id
  AND dep.deposit_type = 'STORAGE'
JOIN analytics.stg_ims_r__location loc ON loc.location_id = dep.location_id
  AND loc.location_id IN (${HUB_LOCATION_IDS})
JOIN analytics.stg_ims_r__item it ON it.item_id = inv.item_id
JOIN analytics.stg_ims_r__item_group ig ON ig.item_group_id = it.item_group_id
WHERE ig.item_group_name = '${safeName}'
  AND led.created_at >= now() - INTERVAL ${days} DAY
GROUP BY dt, location_id
ORDER BY dt DESC`;

  const rows = await chQuery<LedgerDeltaRow>(sql);

  // Build deltasByDate: date → hub → net change that day
  const deltasByDate = new Map<string, Record<HubId, number>>();
  for (const row of rows) {
    const dt = String(row.dt).slice(0, 10);
    const hub = HUB_BY_LOCATION[Number(row.location_id)];
    if (!hub) continue;
    let m = deltasByDate.get(dt);
    if (!m) {
      m = { osasco: 0, mooca: 0, sbc: 0 };
      deltasByDate.set(dt, m);
    }
    m[hub] += Number(row.net_delta) || 0;
  }

  // Reconstruct backwards from current stock.
  // stock(today - k) = currentByHub - Σ(delta(day) for day from today down to today-(k-1))
  const today = todayUtc();
  const byHubMaps: Record<HubId, Map<string, number>> = {
    osasco: new Map(),
    mooca: new Map(),
    sbc: new Map(),
  };
  const globalByDate = new Map<string, number>();
  const cumDelta: Record<HubId, number> = { osasco: 0, mooca: 0, sbc: 0 };

  for (let daysBack = 0; daysBack <= days; daysBack++) {
    const d = addDays(today, -daysBack);
    let global = 0;
    for (const hub of HUBS) {
      const s = Math.max(0, (currentByHub[hub] ?? 0) - cumDelta[hub]);
      byHubMaps[hub].set(d, s);
      global += s;
    }
    globalByDate.set(d, global);

    // Accumulate this day's delta before moving to the next (earlier) day
    const dayDelta = deltasByDate.get(d);
    if (dayDelta) {
      for (const hub of HUBS) cumDelta[hub] += dayDelta[hub];
    }
  }

  return {
    global: toSeries(globalByDate),
    byHub: {
      osasco: toSeries(byHubMaps.osasco),
      mooca: toSeries(byHubMaps.mooca),
      sbc: toSeries(byHubMaps.sbc),
    },
  };
}

async function fetchHistoryFromSupabase(skuName: string, days: number): Promise<StockHistory> {
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
