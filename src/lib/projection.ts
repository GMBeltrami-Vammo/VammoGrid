import type {
  InventoryItem,
  ProjectionPoint,
  PurchaseOrder,
  SkuParams,
  StockProjection,
} from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Stock projection — the "future expectation" for each SKU.
//
// Starting from current on-hand stock, we walk forward day by day:
//   stock(d) = stock(d-1) − consumption + inbound(POs arriving) + recovery
//
//   • consumption — current avg daily consumption (un/day, summed across hubs)
//   • inbound     — PO units arriving on their ETA (or order_date + lead_time).
//                   POs whose ETA is already past but not yet received are
//                   treated as arriving on day 0 (expected/overdue).
//   • recovery    — recovered parts flowing back into stock (Osasco). Modelled as
//                   a daily inflow of recovery_rate × daily consumption, starting
//                   after recovery_lookback_days (the repair turnaround N). This
//                   is the operational reading of: recovery = rate × consumption(N).
//
// All inputs are keyed by SKU code (InventoryItem.skuId === PurchaseOrder.sku).
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_HORIZON_DAYS = 120;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** The date a PO is expected to land, or null if neither ETA nor lead time is known. */
export function arrivalDate(order: PurchaseOrder): string | null {
  if (order.eta) return order.eta;
  if (order.leadTimeDays != null) return addDays(order.orderDate, order.leadTimeDays);
  return null;
}

const OPEN_STATUSES = new Set(['ordered', 'in_transit', 'customs']);

interface ProjectSkuInput {
  sku: string;
  skuName: string;
  items: InventoryItem[]; // all hubs for this SKU (live inventory)
  orders: PurchaseOrder[]; // POs for this SKU
  params?: SkuParams | null;
  horizonDays?: number;
  startDate?: string; // defaults to today (UTC)
}

export function projectSku({
  sku,
  skuName,
  items,
  orders,
  params,
  horizonDays = DEFAULT_HORIZON_DAYS,
  startDate,
}: ProjectSkuInput): StockProjection {
  const start = startDate ?? new Date().toISOString().slice(0, 10);

  const currentStock = items.reduce((sum, i) => sum + (i.qtyAvailable || 0), 0);
  const dailyConsumption = items.reduce((sum, i) => sum + (i.dailyConsumption || 0), 0);
  const dohNow = dailyConsumption > 0 ? currentStock / dailyConsumption : null;

  // Bucket inbound PO units by arrival day-offset. Overdue-but-open POs land on day 0.
  const inboundByOffset = new Map<number, number>();
  let incomingUnits = 0;
  for (const order of orders) {
    if (!OPEN_STATUSES.has(order.status)) continue;
    const arrival = arrivalDate(order);
    if (!arrival) continue;
    let offset = diffDays(start, arrival);
    if (offset < 0) offset = 0; // overdue → expected now
    if (offset > horizonDays) continue;
    inboundByOffset.set(offset, (inboundByOffset.get(offset) ?? 0) + order.qtyOrdered);
    incomingUnits += order.qtyOrdered;
  }

  const recoveryRate = params?.recoveryRate ?? 0;
  const recoveryStart = params?.recoveryLookbackDays ?? 0;
  const dailyRecovery = recoveryRate * dailyConsumption;

  const timeline: ProjectionPoint[] = [];
  let stock = currentStock;
  let stockoutDate: string | null = null;

  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(start, i);
    const inbound = inboundByOffset.get(i) ?? 0;
    const recovery = i >= recoveryStart ? dailyRecovery : 0;
    // Day 0 is "now" — consumption starts day 1.
    const consumption = i === 0 ? 0 : dailyConsumption;

    stock = stock + inbound + recovery - consumption;

    // Only a SKU with actual demand can "run out" — zero-consumption items
    // never rupture, even if their stock is 0.
    if (stockoutDate === null && stock <= 0 && dailyConsumption > 0) {
      stockoutDate = date;
    }

    timeline.push({
      date,
      stock: Math.max(0, Math.round(stock)),
      inbound: Math.round(inbound),
      recovery: Math.round(recovery * 10) / 10,
      consumption: Math.round(consumption * 10) / 10,
    });
  }

  return {
    sku,
    skuName,
    currentStock,
    dailyConsumption,
    dohNow,
    stockoutDate,
    daysUntilStockout: stockoutDate ? diffDays(start, stockoutDate) : null,
    incomingUnits,
    timeline,
  };
}

/** Project every SKU present in the live inventory. */
export function projectAll(
  items: InventoryItem[],
  orders: PurchaseOrder[],
  paramsBySku: Map<string, SkuParams>,
  opts?: { horizonDays?: number; startDate?: string },
): StockProjection[] {
  const itemsBySku = new Map<string, InventoryItem[]>();
  const nameBySku = new Map<string, string>();
  for (const item of items) {
    const list = itemsBySku.get(item.skuId);
    if (list) list.push(item);
    else itemsBySku.set(item.skuId, [item]);
    if (!nameBySku.has(item.skuId)) nameBySku.set(item.skuId, item.skuName);
  }

  const ordersBySku = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const list = ordersBySku.get(order.sku);
    if (list) list.push(order);
    else ordersBySku.set(order.sku, [order]);
  }

  const result: StockProjection[] = [];
  for (const [sku, skuItems] of itemsBySku) {
    result.push(
      projectSku({
        sku,
        skuName: nameBySku.get(sku) ?? sku,
        items: skuItems,
        orders: ordersBySku.get(sku) ?? [],
        params: paramsBySku.get(sku) ?? null,
        horizonDays: opts?.horizonDays,
        startDate: opts?.startDate,
      }),
    );
  }
  return result;
}
