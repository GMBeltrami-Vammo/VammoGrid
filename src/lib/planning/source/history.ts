import 'server-only';
import { cachedChQuery } from '@/lib/clickhouse/reader';
import type { HubId } from '@/types/planning';

// Historical on-hand (last `days` days), keyed by sku_base.
//
// Source: analytics.mart_inventory_snapshot_daily — the ClickHouse daily inventory
// mart, keyed by sku_base and matching the live-stock universe (same int_inventory
// lineage). This joins the displayed current stock exactly, unlike the Supabase
// fleet.piece_stock_hub snapshot whose sku_name (Maestro #29571 naming) diverges
// from the ClickHouse item_group_name and so could never match by name.
//
// The mart is network-total (no location split), so per-hub history is derived by
// applying the current on-hand distribution to each historical day — keeping each
// hub series continuous with the projection's per-hub starting point at D0.

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

interface MartRow {
  dt: string;
  qty: number | string;
}

/**
 * Historical network on-hand for a SKU (by sku_base) over the last `days` days,
 * split to hubs by the current on-hand distribution.
 */
export async function fetchStockHistory(
  skuBase: string,
  currentByHub: Record<HubId, number>,
  days = 30,
): Promise<StockHistory> {
  if (!skuBase) return emptyHistory();

  const safeBase = skuBase.replace(/'/g, "''");
  const sql = `
SELECT toString(snapshot_date) AS dt,
       toFloat64(sum(quantity_available)) AS qty
FROM analytics.mart_inventory_snapshot_daily
WHERE sku_base = '${safeBase}'
  AND snapshot_date >= today() - ${Math.abs(days)}
GROUP BY snapshot_date
ORDER BY snapshot_date`;

  let rows: MartRow[] = [];
  try {
    // Per-SKU daily snapshot; cache 10 min (keyed by the SQL → per sku_base + window).
    rows = await cachedChQuery<MartRow>(sql, 600, ['stock']);
  } catch {
    return emptyHistory();
  }
  if (rows.length === 0) return emptyHistory();

  // Current on-hand share per hub (lands the per-hub series at today's stock at D0).
  const total = HUBS.reduce((s, h) => s + (currentByHub[h] ?? 0), 0);
  const share: Record<HubId, number> =
    total > 0
      ? {
          osasco: (currentByHub.osasco ?? 0) / total,
          mooca: (currentByHub.mooca ?? 0) / total,
          sbc: (currentByHub.sbc ?? 0) / total,
        }
      : { osasco: 0, mooca: 0, sbc: 0 };

  const global: HistoryPoint[] = [];
  const byHub: Record<HubId, HistoryPoint[]> = { osasco: [], mooca: [], sbc: [] };

  for (const r of rows) {
    const date = String(r.dt).slice(0, 10);
    const stock = Math.round(Number(r.qty) || 0);
    global.push({ date, stock });
    for (const h of HUBS) byHub[h].push({ date, stock: Math.round(stock * share[h]) });
  }

  return { global, byHub };
}
