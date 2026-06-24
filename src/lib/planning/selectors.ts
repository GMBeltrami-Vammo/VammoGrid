import type {
  HubId,
  OpenPurchaseOrder,
  PurchaseStatus,
  PurchaseSuggestion,
  RiskLevel,
  SkuForecast,
  SkuPolicy,
  StockState,
  TransferSuggestion,
} from '@/types/planning';
import { HUB_IDS } from '@/constants/planningHubs';
import { daysFromToday } from './format';
import { meanDailyDemand } from './forecast';

// Pure derivations for the dashboard surfaces. No I/O — unit-testable.

const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

/** 0–100 inventory health: penalize critical (1.0), reorder (0.4), late PO (0.5). */
export function healthScore(purchases: PurchaseSuggestion[]): number {
  if (purchases.length === 0) return 100;
  let penalty = 0;
  for (const p of purchases) {
    if (p.status === 'CRITICAL') penalty += 1;
    else if (p.status === 'REORDER') penalty += 0.4;
    if (p.isLate) penalty += 0.5;
  }
  const score = 100 * (1 - penalty / (purchases.length * 1.5));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function countByStatus(purchases: PurchaseSuggestion[]) {
  let critical = 0;
  let reorder = 0;
  let ok = 0;
  let late = 0;
  for (const p of purchases) {
    if (p.status === 'CRITICAL') critical++;
    else if (p.status === 'REORDER') reorder++;
    else ok++;
    if (p.isLate) late++;
  }
  return { critical, reorder, ok, late };
}

/** Most urgent first: by risk, then soonest stockout, then largest order. */
export function byUrgency(a: PurchaseSuggestion, b: PurchaseSuggestion): number {
  const r = RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel];
  if (r !== 0) return r;
  const sa = a.stockoutDate ?? '9999-12-31';
  const sb = b.stockoutDate ?? '9999-12-31';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return b.orderQty - a.orderQty;
}

export function actionablePurchases(purchases: PurchaseSuggestion[]): PurchaseSuggestion[] {
  return purchases.filter((p) => p.orderQty > 0 || p.status !== 'OK').sort(byUrgency);
}

export function totalOrderCost(purchases: PurchaseSuggestion[]): number {
  return purchases.reduce((s, p) => s + (p.estCost ?? 0), 0);
}

export function totalOrderUnits(purchases: PurchaseSuggestion[]): number {
  return purchases.reduce((s, p) => s + p.orderQty, 0);
}

export function upcomingStockouts(
  purchases: PurchaseSuggestion[],
  today: string,
  withinDays = 30,
): PurchaseSuggestion[] {
  return purchases
    .filter((p) => {
      const d = daysFromToday(p.stockoutDate, today);
      return d != null && d <= withinDays;
    })
    .sort((a, b) => (a.stockoutDate ?? '') < (b.stockoutDate ?? '') ? -1 : 1);
}

export function transfersByHub(
  transfers: TransferSuggestion[],
): Record<HubId, { count: number; qty: number }> {
  const out: Record<HubId, { count: number; qty: number }> = {
    osasco: { count: 0, qty: 0 },
    mooca: { count: 0, qty: 0 },
    sbc: { count: 0, qty: 0 },
  };
  for (const t of transfers) {
    out[t.toHub].count++;
    out[t.toHub].qty += t.qty;
  }
  return out;
}

export function networkOnHand(stocks: StockState[]): {
  total: number;
  byHub: Record<HubId, number>;
} {
  const byHub: Record<HubId, number> = { osasco: 0, mooca: 0, sbc: 0 };
  let total = 0;
  for (const s of stocks) {
    byHub.osasco += s.byHub.osasco;
    byHub.mooca += s.byHub.mooca;
    byHub.sbc += s.byHub.sbc;
    total += s.total;
  }
  return { total, byHub };
}

// ─── Hub risk ranking (Q2: which hub is at highest risk) ──────────────────────

export interface HubRisk {
  hub: HubId;
  skus: number;
  atRisk: number;
  unitsOnHand: number;
  worstCover: number | null;
}

/** Per-hub risk: count SKUs whose per-hub cover (on-hand ÷ hub daily demand) is
 *  below `riskDays`. Ranked most-at-risk first. */
export function computeHubRisk(args: {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  sharesFor: (s: StockState) => Record<HubId, number>;
  riskDays?: number;
}): HubRisk[] {
  const riskDays = args.riskDays ?? 14;
  return HUB_IDS.map((hub) => {
    let skus = 0;
    let atRisk = 0;
    let unitsOnHand = 0;
    let worst: number | null = null;
    for (const s of args.stocks) {
      const daily = meanDailyDemand(args.forecasts.get(s.skuBase) ?? null) * args.sharesFor(s)[hub];
      const onHand = s.byHub[hub] ?? 0;
      if (onHand === 0 && daily === 0) continue;
      skus++;
      unitsOnHand += onHand;
      const cover = daily > 0 ? onHand / daily : null;
      if (cover != null) {
        if (cover < riskDays) atRisk++;
        if (worst === null || cover < worst) worst = cover;
      }
    }
    return { hub, skus, atRisk, unitsOnHand, worstCover: worst };
  }).sort((a, b) => b.atRisk - a.atRisk || (a.worstCover ?? Infinity) - (b.worstCover ?? Infinity));
}

// ─── Delayed shipments (Q6: which delayed shipment creates the most risk) ─────

export interface DelayedShipment {
  order: OpenPurchaseOrder;
  skuName: string;
  daysLate: number;
  status: PurchaseStatus | null;
  stockoutDate: string | null;
}

const OPEN_STATUSES = new Set(['ordered', 'in_transit', 'customs']);
const STATUS_RANK: Record<string, number> = { CRITICAL: 0, REORDER: 1, OK: 2 };

/** Open POs whose ETA is already past, ranked by the risk of the SKU they serve. */
export function delayedShipments(
  orders: OpenPurchaseOrder[],
  purchasesBySku: Map<string, PurchaseSuggestion>,
  today: string,
): DelayedShipment[] {
  const out: DelayedShipment[] = [];
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status) || !o.eta) continue;
    const offset = daysFromToday(o.eta, today);
    if (offset == null || offset >= 0) continue; // only overdue
    const p = purchasesBySku.get(o.skuBase);
    out.push({
      order: o,
      skuName: o.skuName ?? p?.skuName ?? o.skuBase,
      daysLate: -offset,
      status: p?.status ?? null,
      stockoutDate: p?.stockoutDate ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      STATUS_RANK[a.status ?? 'OK'] - STATUS_RANK[b.status ?? 'OK'] ||
      b.daysLate - a.daysLate ||
      b.order.qty - a.order.qty,
  );
}

// ─── Supply mix (Q8: recovery vs procurement over the horizon) ────────────────

export function supplyMix(args: {
  purchases: PurchaseSuggestion[];
  forecasts: Map<string, SkuForecast>;
  policies: Map<string, SkuPolicy>;
  horizon?: number;
}): { procurement: number; recovery: number } {
  const horizon = args.horizon ?? 150;
  let procurement = 0;
  for (const p of args.purchases) procurement += p.incomingUnits;

  let recovery = 0;
  for (const [sku, pol] of args.policies) {
    if (!pol.isRepairable || pol.recoveryRate <= 0) continue;
    const fc = args.forecasts.get(sku);
    if (!fc) continue;
    let demand = 0;
    for (const pt of fc.points) if (pt.day <= horizon) demand += pt.yhat;
    recovery += pol.recoveryRate * demand;
  }
  return { procurement: Math.round(procurement), recovery: Math.round(recovery) };
}
