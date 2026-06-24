import 'server-only';
import { chQuery } from '@/lib/clickhouse/reader';

// Historical network on-hand per SKU from the warehouse daily snapshot mart
// (analytics.mart_inventory_snapshot_daily). Used to show the last ~30 days before
// the projection so the chart spans D-30 → D+horizon. Network-total (not per hub).

export interface HistoryPoint {
  date: string;
  stock: number;
}

export async function fetchHistory(skuBase: string, days = 30): Promise<HistoryPoint[]> {
  const safe = skuBase.replace(/'/g, "''");
  const sql = `
SELECT toString(snapshot_date) AS date, toFloat64(quantity_available) AS qty
FROM analytics.mart_inventory_snapshot_daily
WHERE sku_base = '${safe}' AND snapshot_date >= today() - ${Math.max(1, Math.round(days))}
ORDER BY snapshot_date`;
  try {
    const rows = await chQuery<{ date: string; qty: number | string }>(sql);
    return rows.map((r) => ({ date: String(r.date).slice(0, 10), stock: Math.round(Number(r.qty) || 0) }));
  } catch {
    return [];
  }
}
