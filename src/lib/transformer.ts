import type { DohStatus, HubId, InventoryItem } from '@/types';

const DOH_WARNING = Number(process.env.DOH_WARNING_THRESHOLD) || 14;
const DOH_CRITICAL = Number(process.env.DOH_CRITICAL_THRESHOLD) || 7;

function deriveDohStatus(doh: number | null): DohStatus {
  if (doh === null) return 'unknown';
  if (doh <= DOH_CRITICAL) return 'critical';
  if (doh <= DOH_WARNING) return 'warning';
  return 'ok';
}

// Metabase question #27759 returns one row per SKU with hub quantities pivoted
// as separate columns: qty_mooca, qty_osasco, qty_sbc.
// We unpivot here to produce one InventoryItem per (SKU, hub) pair.
//
// Row shape (confirmed):
//   sku                  — SKU code, e.g. "VM-01-MOT0-0102"
//   item_group           — Item description, e.g. "Rolamento do motor"
//   qty_total            — Total qty across all hubs
//   qty_mooca            — Qty at Mooca
//   qty_osasco           — Qty at Osasco
//   qty_sbc              — Qty at São Bernardo do Campo
//   consumo_diario_l30d  — Daily consumption rate (avg last 30 days)
//   doh                  — Overall DOH (qty_total / consumo_diario_l30d)

const HUB_COLUMNS: { column: string; hubId: HubId }[] = [
  { column: 'qty_mooca', hubId: 'mooca' },
  { column: 'qty_osasco', hubId: 'osasco' },
  { column: 'qty_sbc', hubId: 'sbc' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformInventoryRows(rows: Record<string, any>[]): InventoryItem[] {
  const items: InventoryItem[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const skuId = String(row['sku'] ?? '').trim();
    const skuName = String(row['item_group'] ?? 'Sem nome').trim();
    const dailyConsumption = Number(row['consumo_diario_l30d']) || 0;

    if (!skuId) continue;

    for (const { column, hubId } of HUB_COLUMNS) {
      const qty = Number(row[column]) || 0;

      // Per-hub DOH: how many days this hub can serve at the global consumption rate.
      // If consumption is zero, DOH is unknown (null) rather than Infinity.
      const doh: number | null =
        dailyConsumption > 0 ? Math.round((qty / dailyConsumption) * 10) / 10 : null;

      items.push({
        skuId,
        skuName,
        category: skuName, // item_group serves as category for now
        hubId,
        qtyAvailable: qty,
        doh,
        dohStatus: deriveDohStatus(doh),
        lastUpdated: now,
      });
    }
  }

  return items;
}
