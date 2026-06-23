import type {
  HubId,
  OpenPurchaseOrder,
  ProjectionPoint,
  ProjectionScope,
  SkuForecast,
  SkuPolicy,
  StockProjection,
  StockState,
} from '@/types/planning';
import { HORIZON_DAYS } from './constants';
import { addDays, diffDays } from './dates';
import { buildDailyDemand, type DailyDemand } from './forecast';

// ─────────────────────────────────────────────────────────────────────────────
// Projection Engine — the per-day inventory walk, for scope ∈ {global, hub, SKU}.
//
//   stock(d) = stock(d−1) − demand(d) + inbound(d) + recovery(d) + transfers(d)
//
//   • demand   — forecast yhat (per scope; per-hub = fleet × hub share)
//   • inbound  — open-PO units landing on ETA (overdue-but-open → day 0). POs land
//                at Osasco, so only the global + Osasco streams receive them.
//   • recovery — recoveryRate × demand(d − turnaround) for repairable SKUs, credited
//                to Osasco (and the global total).
//   • band     — stockLo uses pessimistic (high) demand; stockHi uses optimistic (low).
// ─────────────────────────────────────────────────────────────────────────────

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];
const OPEN_STATUSES = new Set(['ordered', 'in_transit', 'customs']);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Inbound open-PO units bucketed by arrival day-offset from `today`. */
function bucketReceipts(orders: OpenPurchaseOrder[], today: string, horizon: number): number[] {
  const receipts = new Array<number>(horizon + 1).fill(0);
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    let offset = diffDays(today, arrival);
    if (offset < 0) offset = 0;
    if (offset > horizon) continue;
    receipts[offset] += o.qty;
  }
  return receipts;
}

function scaleDemand(d: DailyDemand, factor: number): DailyDemand {
  return {
    yhat: d.yhat.map((v) => v * factor),
    lo: d.lo.map((v) => v * factor),
    hi: d.hi.map((v) => v * factor),
    horizon: d.horizon,
    length: d.length,
  };
}

interface StreamInput {
  skuBase: string;
  skuName: string;
  scope: ProjectionScope;
  startStock: number;
  demand: DailyDemand;
  receipts: number[];
  recoveryRate: number;
  recoveryTurnaround: number;
  creditsRecovery: boolean;
  isRepairable: boolean;
  today: string;
  horizon: number;
}

export function projectStream(i: StreamInput): StockProjection {
  const { horizon } = i;
  const timeline: ProjectionPoint[] = [];
  let stock = i.startStock;
  let stockLo = i.startStock;
  let stockHi = i.startStock;
  let stockoutDay: number | null = null;
  let incomingUnits = 0;

  const window = Math.min(30, horizon);
  let avgDaily = 0;
  for (let d = 1; d <= window; d++) avgDaily += i.demand.yhat[d] ?? 0;
  avgDaily = window > 0 ? avgDaily / window : 0;

  for (let d = 0; d <= horizon; d++) {
    const demand = d === 0 ? 0 : i.demand.yhat[d];
    const demandHi = d === 0 ? 0 : i.demand.hi[d];
    const demandLo = d === 0 ? 0 : i.demand.lo[d];
    const inbound = i.receipts[d] ?? 0;
    incomingUnits += inbound;
    const recovery =
      i.creditsRecovery && i.isRepairable && d - i.recoveryTurnaround >= 1
        ? i.recoveryRate * (i.demand.yhat[d - i.recoveryTurnaround] ?? 0)
        : 0;

    stock = stock + inbound + recovery - demand;
    stockHi = stockHi + inbound + recovery - demandLo; // low demand → more stock left
    stockLo = stockLo + inbound + recovery - demandHi; // high demand → less stock left

    if (stockoutDay === null && d > 0 && stock <= 0 && avgDaily > 0) stockoutDay = d;

    timeline.push({
      date: addDays(i.today, d),
      day: d,
      stock: Math.max(0, Math.round(stock)),
      stockLo: Math.max(0, Math.round(stockLo)),
      stockHi: Math.max(0, Math.round(stockHi)),
      demand: round1(demand),
      inbound: Math.round(inbound),
      recovery: round1(recovery),
      transferIn: 0,
      transferOut: 0,
      extrapolated: d > i.demand.horizon,
    });
  }

  const dohNow = avgDaily > 0 ? i.startStock / avgDaily : null;
  return {
    skuBase: i.skuBase,
    skuName: i.skuName,
    scope: i.scope,
    currentStock: i.startStock,
    dailyDemand: round1(avgDaily),
    dohNow: dohNow != null ? round1(dohNow) : null,
    stockoutDate: stockoutDay != null ? addDays(i.today, stockoutDay) : null,
    daysUntilStockout: stockoutDay,
    incomingUnits,
    timeline,
  };
}

export interface SkuProjections {
  global: StockProjection;
  byHub: Record<HubId, StockProjection>;
}

/** Project one SKU at global scope and per hub, using per-hub demand shares. */
export function projectSku(args: {
  stock: StockState;
  forecast: SkuForecast | null;
  orders: OpenPurchaseOrder[];
  policy: SkuPolicy;
  shares: Record<HubId, number>;
  today: string;
  horizon?: number;
}): SkuProjections {
  const horizon = args.horizon ?? HORIZON_DAYS;
  const fleet = buildDailyDemand(args.forecast, horizon);
  const receiptsGlobal = bucketReceipts(args.orders, args.today, horizon);
  const zeros = new Array<number>(horizon + 1).fill(0);

  const global = projectStream({
    skuBase: args.stock.skuBase,
    skuName: args.stock.skuName,
    scope: 'global',
    startStock: args.stock.total,
    demand: fleet,
    receipts: receiptsGlobal,
    recoveryRate: args.policy.recoveryRate,
    recoveryTurnaround: args.policy.recoveryTurnaroundDays,
    creditsRecovery: true,
    isRepairable: args.policy.isRepairable,
    today: args.today,
    horizon,
  });

  const byHub = {} as Record<HubId, StockProjection>;
  for (const h of HUBS) {
    byHub[h] = projectStream({
      skuBase: args.stock.skuBase,
      skuName: args.stock.skuName,
      scope: h,
      startStock: args.stock.byHub[h] ?? 0,
      demand: scaleDemand(fleet, args.shares[h] ?? 0),
      receipts: h === 'osasco' ? receiptsGlobal : zeros,
      recoveryRate: args.policy.recoveryRate,
      recoveryTurnaround: args.policy.recoveryTurnaroundDays,
      creditsRecovery: h === 'osasco',
      isRepairable: args.policy.isRepairable,
      today: args.today,
      horizon,
    });
  }

  return { global, byHub };
}
