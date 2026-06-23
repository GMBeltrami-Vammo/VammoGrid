import type {
  HubId,
  PurchaseSuggestion,
  RiskLevel,
  StockState,
  TransferSuggestion,
} from '@/types/planning';
import { daysFromToday } from './format';

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
