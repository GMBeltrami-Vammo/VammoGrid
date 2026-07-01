import type {
  ElaborationSuggestion,
  SkuPolicy,
  StockProjection,
  StockState,
} from '@/types/planning';
import { DEFAULT_LEAD_TIME_DAYS, ELABORATION_DOH_THRESHOLD, INTERNATIONAL_AIR_LEAD_DAYS } from './constants';
import { addDays, nextFirstOfMonth } from './dates';

// ─────────────────────────────────────────────────────────────────────────────
// Elaboration trigger (sub-project B5) — Compras' reorder rule, per the user's
// spec review. PURE + deterministic (takes an explicit `today`), computed on demand,
// never on a schedule that writes. Distinct from the statistical ROP:
//
//   1. Scan the projected stock timeline for the first day DOH < threshold (75).
//      DOH(d) = stock(d) / daily demand(d); no demand ⇒ no breach.
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
  dohThreshold?: number;
}): ElaborationSuggestion {
  const { stock, projection, policy, today } = args;
  const threshold = args.dohThreshold ?? ELABORATION_DOH_THRESHOLD;

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

  // 1. First day projected DOH dips below the threshold.
  let firstBreachDate: string | null = null;
  let breachDoh: number | null = null;
  for (const p of projection.timeline) {
    if (p.day === 0 || p.demand <= 0) continue;
    const doh = p.stock / p.demand;
    if (doh < threshold) {
      firstBreachDate = p.date;
      breachDoh = Math.round(doh);
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
