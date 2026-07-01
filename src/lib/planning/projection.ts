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
import { countsAsInbound } from '@/types/planning';
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
    // Un-placed drafts (elaborado/enviado) are not real inbound yet — B6.
    if (!countsAsInbound(o.prepStatus)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    let offset = diffDays(today, arrival);
    if (offset < 0) offset = 0;
    if (offset > horizon) continue;
    receipts[offset] += o.qty;
  }
  return receipts;
}

/** Open-PO arrivals bucketed by date (same rule as bucketReceipts), with the VO(s)
 *  and total qty landing each day — for labeling the projection chart. */
export interface PoArrival {
  date: string;
  qty: number;
  vos: string[];
}

export function computeArrivals(
  orders: OpenPurchaseOrder[],
  today: string,
  horizon: number = HORIZON_DAYS,
): PoArrival[] {
  const byDate = new Map<string, { qty: number; vos: Set<string> }>();
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    if (!countsAsInbound(o.prepStatus)) continue; // drafts aren't real arrivals yet — B6
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    let offset = diffDays(today, arrival);
    if (offset < 0) offset = 0;
    if (offset > horizon) continue;
    const date = addDays(today, offset);
    const e = byDate.get(date) ?? { qty: 0, vos: new Set<string>() };
    e.qty += o.qty;
    if (o.vo) e.vos.add(o.vo);
    byDate.set(date, e);
  }
  return [...byDate.entries()]
    .map(([date, e]) => ({ date, qty: e.qty, vos: [...e.vos] }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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
  // Band via error propagation, NOT a linear sum of daily bands. Treating each day's
  // forecast band as an independent uncertainty, the cumulative demand uncertainty
  // grows as the root-sum-of-squares (≈√horizon), not the linear sum (≈horizon). The
  // old walk added (hi−lo) every day → a worst-case "demand high every single day"
  // envelope that fanned out ~√horizon too wide. We accumulate the squared daily
  // deviations and take the sqrt as the band half-width around the central walk.
  let sumSqLo = 0; // Σ (yhat − lo)² → optimistic upper band (demand below forecast)
  let sumSqHi = 0; // Σ (hi − yhat)² → pessimistic lower band (demand above forecast)
  let stockoutDay: number | null = null;
  let incomingUnits = 0;

  const window = Math.min(30, horizon);
  let avgDaily = 0;
  for (let d = 1; d <= window; d++) avgDaily += i.demand.yhat[d] ?? 0;
  avgDaily = window > 0 ? avgDaily / window : 0;

  for (let d = 0; d <= horizon; d++) {
    const demand = d === 0 ? 0 : i.demand.yhat[d];
    const inbound = i.receipts[d] ?? 0;
    incomingUnits += inbound;
    const recovery =
      i.creditsRecovery && i.isRepairable && d - i.recoveryTurnaround >= 1
        ? i.recoveryRate * (i.demand.yhat[d - i.recoveryTurnaround] ?? 0)
        : 0;

    // Central walk on the expected demand (yhat). POs + recovery are treated as known.
    stock = stock + inbound + recovery - demand;
    if (d > 0) {
      const devLo = Math.max(0, i.demand.yhat[d] - i.demand.lo[d]);
      const devHi = Math.max(0, i.demand.hi[d] - i.demand.yhat[d]);
      sumSqLo += devLo * devLo;
      sumSqHi += devHi * devHi;
    }
    const stockHi = stock + Math.sqrt(sumSqLo); // low demand → more stock left
    const stockLo = stock - Math.sqrt(sumSqHi); // high demand → less stock left

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
