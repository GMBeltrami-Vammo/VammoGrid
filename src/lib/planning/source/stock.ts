import 'server-only';
import type { HubId, StockState } from '@/types/planning';
import { HUB_BY_LOCATION, HUB_LOCATION_IDS } from '@/constants/planningHubs';
import { chQuery } from '@/lib/clickhouse/reader';
import { toSkuBase } from '../sku';

// Per-hub on-hand: AVAILABLE inventory in STORAGE deposits at the three hub
// locations (validated: STORAGE holds the planning-relevant stock; DEPLOYED/RESERVED
// excluded). One sku_base spans several sku_codes (variants) → aggregated at base.

interface StockRow {
  sku_code: string;
  sku_name: string;
  is_repairable: boolean | number;
  category: string | null;
  unit_price: number | string | null;
  location_id: number | string;
  qty: number | string;
}

const STOCK_SQL = `
SELECT
  it.item_code         AS sku_code,
  ig.item_group_name   AS sku_name,
  ig.is_repairable     AS is_repairable,
  ig.compatible_asset  AS category,
  toFloat64(ig.price)  AS unit_price,
  loc.location_id      AS location_id,
  sum(toFloat64(inv.quantity)) AS qty
FROM analytics.stg_ims_r__inventory inv
JOIN analytics.stg_ims_r__deposit dep ON dep.deposit_id = inv.deposit_id
JOIN analytics.stg_ims_r__location loc ON loc.location_id = dep.location_id
JOIN analytics.stg_ims_r__item it ON it.item_id = inv.item_id
JOIN analytics.stg_ims_r__item_group ig ON ig.item_group_id = it.item_group_id
WHERE inv.inventory_status = 'AVAILABLE'
  AND dep.deposit_type = 'STORAGE'
  AND loc.location_id IN (${HUB_LOCATION_IDS})
GROUP BY sku_code, sku_name, is_repairable, category, unit_price, location_id`;

function zeroHubs(): Record<HubId, number> {
  return { osasco: 0, mooca: 0, sbc: 0 };
}

export async function fetchStockStates(nowIso: string): Promise<StockState[]> {
  const rows = await chQuery<StockRow>(STOCK_SQL);

  const bySku = new Map<string, StockState>();
  for (const r of rows) {
    const skuBase = toSkuBase(String(r.sku_code));
    const hub = HUB_BY_LOCATION[Number(r.location_id)];
    if (!hub) continue;

    let s = bySku.get(skuBase);
    if (!s) {
      s = {
        skuBase,
        skuName: String(r.sku_name ?? skuBase),
        byHub: zeroHubs(),
        total: 0,
        unitPrice: null,
        isRepairable: false,
        category: r.category ? String(r.category) : null,
        lastUpdated: nowIso,
      };
      bySku.set(skuBase, s);
    }
    if (!s.category && r.category) s.category = String(r.category);
    const qty = Number(r.qty) || 0;
    s.byHub[hub] += qty;
    s.total += qty;
    const price = r.unit_price == null ? null : Number(r.unit_price);
    if (price != null && (s.unitPrice == null || price > s.unitPrice)) s.unitPrice = price;
    if (Number(r.is_repairable) === 1 || r.is_repairable === true) s.isRepairable = true;
  }

  return [...bySku.values()].sort((a, b) => b.total - a.total);
}
