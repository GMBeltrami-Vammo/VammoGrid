import type { ConsumptionRecord, DohStatus, HubId, InventoryItem } from '@/types';

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

// ---------------------------------------------------------------------------
// Consumption transformer — Metabase question #29567
//
// Row shape (confirmed from live data):
//   day          — ISO date string, e.g. "2026-06-03T00:00:00-03:00"
//   item_group   — Maestro item name, e.g. "Amortecedor traseiro"
//   hub          — 'mooca' | 'osasco' | 'sbc'
//   qty_consumed — integer units consumed that day at that hub
//   os           — sorted array of Maestro OS IDs (may arrive as "[1,2,3]" string)
//   monthly_avg  — avg daily consumption over the 30-day window for item+hub
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOsArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(Number).filter(Boolean);
    } catch {
      // fall through
    }
  }
  return [];
}

const VALID_HUBS = new Set<HubId>(['mooca', 'osasco', 'sbc']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformConsumptionRows(rows: Record<string, any>[]): ConsumptionRecord[] {
  return rows.flatMap((row) => {
    const itemGroup = String(row['item_group'] ?? '').trim();
    const hubId = String(row['hub'] ?? '').trim() as HubId;

    if (!itemGroup || !VALID_HUBS.has(hubId)) return [];

    return [{
      itemGroup,
      hubId,
      day: String(row['day'] ?? ''),
      qtyConsumed: Number(row['qty_consumed']) || 0,
      os: parseOsArray(row['os']),
      monthlyAvg: Number(row['monthly_avg']) || 0,
    }];
  });
}
