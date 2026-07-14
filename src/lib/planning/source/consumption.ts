import 'server-only';
import { unstable_cache } from 'next/cache';
import { chQuery } from '@/lib/clickhouse/reader';
import { toSkuBase } from '../sku';

// Realized daily consumption per sku_base from the IMS ledger (USAGE_* deltas) — the
// "realizado" side of previsão × realizado (review 8 fase 2). Network-total (no hub
// restriction) to match the fleet-level forecast. One sku_base spans several item_codes
// (variants), so we fetch by item_code prefix and re-aggregate by base in JS.

interface ConsRow {
  d: string;
  sku_code: string;
  used: number | string;
}

export interface DailyConsumptionPoint {
  date: string;
  qty: number;
}

/** Daily realized consumption for a sku_base over [fromDate, toDate] (inclusive, ISO). */
export async function fetchDailyConsumption(
  skuBase: string,
  fromDate: string,
  toDate: string,
): Promise<DailyConsumptionPoint[]> {
  if (!skuBase || !fromDate || !toDate) return [];
  const safeBase = skuBase.replace(/'/g, "''");
  const from = fromDate.slice(0, 10).replace(/'/g, "''");
  const to = toDate.slice(0, 10).replace(/'/g, "''");
  const sql = `
    SELECT toDate(led.created_at) AS d,
           it.item_code AS sku_code,
           sum(abs(toFloat64(led.delta))) AS used
    FROM analytics.stg_ims_r__ledger led
    JOIN analytics.stg_ims_r__inventory inv ON inv.inventory_id = led.inventory_id
    JOIN analytics.stg_ims_r__item it ON it.item_id = inv.item_id
    WHERE led.ledger_type LIKE 'USAGE%'
      AND it.item_code LIKE '${safeBase}%'
      AND toDate(led.created_at) BETWEEN '${from}' AND '${to}'
    GROUP BY d, sku_code`;

  let rows: ConsRow[] = [];
  try {
    rows = await unstable_cache(() => chQuery<ConsRow>(sql), ['consumption', skuBase, from, to], {
      revalidate: 3600,
      tags: ['consumption'],
    })();
  } catch (e) {
    console.error('[fetchDailyConsumption]', e instanceof Error ? e.message : e);
    return [];
  }

  // item_code LIKE prefix can catch a different base sharing the prefix → keep only the
  // rows whose derived base matches exactly, and sum variants of the same base per day.
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (toSkuBase(String(r.sku_code)) !== skuBase) continue;
    const date = String(r.d).slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + (Number(r.used) || 0));
  }
  return [...byDate.entries()]
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
