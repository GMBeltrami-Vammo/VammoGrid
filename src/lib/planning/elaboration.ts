import type {
  ElaborationSuggestion,
  SkuPolicy,
  StockProjection,
  StockState,
} from '@/types/planning';
import {
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_PURCHASE_CRITERIA,
  INTERNATIONAL_AIR_LEAD_DAYS,
  type PurchaseCriteria,
} from './constants';
import { addDays, nextFirstOfMonth } from './dates';
import { forwardAvgDemand } from './projection';

// ─────────────────────────────────────────────────────────────────────────────
// Elaboration trigger (sub-project B5) — Compras' reorder rule, per the user's
// spec review. PURE + deterministic (takes an explicit `today`), computed on demand,
// never on a schedule that writes. Distinct from the statistical ROP:
//
//   1. Scan the projected stock timeline for the first day DOH < threshold (75).
//      DOH(d) = stock(d) / avg demand of the next 7 days; no demand ⇒ no breach.
//   2. If none in the horizon → no order.
//   3. Otherwise pick the modal:
//      • Maritime is the default, but sea orders only go out on the 1st of the
//        month → seaArrival = nextFirstOfMonth(today) + leadTimeSeaDays.
//      • Air has no calendar constraint → airArrival = today + leadTimeAirDays.
//      • If sea arrives in time (≤ first-breach date) → suggest maritime.
//        Else if air arrives in time → suggest air.
//        Else → suggest air anyway (best available) but flag it late.
// ─────────────────────────────────────────────────────────────────────────────

export function findElaborationTrigger(args: {
  stock: StockState;
  projection: StockProjection;
  policy: SkuPolicy;
  today: string;
  /** Admin criteria (DOH threshold vs ROP). Defaults to DOH 75. */
  criteria?: PurchaseCriteria;
  /** Reorder point (estoque mínimo + segurança) — used when criteria.mode = 'rop'. */
  rop?: number;
}): ElaborationSuggestion {
  const { stock, projection, policy, today } = args;
  const criteria = args.criteria ?? DEFAULT_PURCHASE_CRITERIA;
  const rop = args.rop ?? 0;

  const seaDays = Math.max(0, Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS));
  const airDays = Math.max(0, Math.round(policy.leadTimeAirDays ?? INTERNATIONAL_AIR_LEAD_DAYS));

  const base = {
    skuBase: stock.skuBase,
    skuName: stock.skuName,
    dohNow: projection.dohNow,
    dailyDemand: projection.dailyDemand,
    leadTimeSeaDays: seaDays,
    leadTimeAirDays: airDays,
  };

  // 1. First day the SKU breaches the request criteria.
  //    • 'doh' → projected coverage (stock ÷ next-7-day avg demand) < the DOH threshold.
  //    • 'rop' → projected stock < the reorder point (estoque mínimo + segurança).
  let firstBreachDate: string | null = null;
  let breachDoh: number | null = null;
  for (const p of projection.timeline) {
    if (p.day === 0) continue;
    const rate = forwardAvgDemand(projection.timeline, p.day, 7);
    const doh = rate > 0 ? p.stock / rate : null;
    const breached =
      criteria.mode === 'rop' ? rop > 0 && p.stock < rop : doh != null && doh < criteria.dohThreshold;
    if (breached) {
      firstBreachDate = p.date;
      breachDoh = doh != null ? Math.round(doh) : null;
      break;
    }
  }

  if (!firstBreachDate) {
    return {
      ...base,
      needsOrder: false,
      firstBreachDate: null,
      breachDoh: null,
      suggestedModal: null,
      suggestedOrderDate: null,
      expectedArrival: null,
      isLate: false,
    };
  }

  // 2. Modal decision — maritime batches monthly; air is anytime.
  const seaOrderDate = nextFirstOfMonth(today);
  const seaArrival = addDays(seaOrderDate, seaDays);
  const airArrival = addDays(today, airDays);

  const seaInTime = seaArrival <= firstBreachDate;
  const airInTime = airArrival <= firstBreachDate;

  if (seaInTime) {
    return {
      ...base,
      needsOrder: true,
      firstBreachDate,
      breachDoh,
      suggestedModal: 'sea',
      suggestedOrderDate: seaOrderDate,
      expectedArrival: seaArrival,
      isLate: false,
    };
  }

  // Sea too late → air. Flag late only when even air can't beat the breach.
  return {
    ...base,
    needsOrder: true,
    firstBreachDate,
    breachDoh,
    suggestedModal: 'air',
    suggestedOrderDate: today,
    expectedArrival: airArrival,
    isLate: !airInTime,
  };
}
