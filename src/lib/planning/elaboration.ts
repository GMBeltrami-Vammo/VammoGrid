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
import { addDays, diffDays, nextFirstOfMonth } from './dates';
import { forwardAvgDemand } from './projection';
import type { ModalOption } from './supplierGroups';

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
  /** Time-varying DOH floor (per-pedido rules, 7b); default = the constant threshold.
   *  Only used in 'doh' mode. */
  floorAt?: (day: number) => number;
}): ElaborationSuggestion {
  const { stock, projection, policy, today, floorAt } = args;
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
    const floor = floorAt ? floorAt(p.day) : criteria.dohThreshold;
    const breached =
      criteria.mode === 'rop' ? rop > 0 && p.stock < rop : doh != null && doh < floor;
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

// ─── Per-pedido rule overrides (review item 7b) ────────────────────────────────
// NOT persisted: they live in the Novo Pedido page URL and override the global Admin
// criteria only for that computation — the heatmap/Semanas keep the global criteria.

export interface AirPeriodRule {
  /** Day offset from today where this minimum starts applying. */
  fromOffset: number;
  /** Minimum DOH to hold from that day on (until the next period). */
  minDoh: number;
}

export interface OrderRules {
  /** DOH floor for the trigger + the sea top-up (default: the global criteria's). */
  seaFloorDoh?: number;
  /** Purchase periodicity — days of cover beyond the floor for the sea bulk (default 30). */
  seaCadenceDays?: number;
  /** Time-varying minimum DOH periods (aéreo): período A → X, período B → Y… */
  airPeriods?: AirPeriodRule[];
}

/** Piecewise floor: the base until the first period starts, then each period's minDoh. */
export function floorAtFactory(baseFloor: number, periods?: AirPeriodRule[]): (day: number) => number {
  if (!periods || periods.length === 0) return () => baseFloor;
  const sorted = [...periods].sort((a, b) => a.fromOffset - b.fromOffset);
  return (day: number) => {
    let floor = baseFloor;
    for (const p of sorted) {
      if (day >= p.fromOffset) floor = p.minDoh;
      else break;
    }
    return floor;
  };
}

/** Parse + clamp the `?rules=` URL param (untrusted): finite positive numbers only,
 *  at most 6 periods. Returns undefined when nothing valid remains. */
export function parseOrderRules(raw: string | undefined | null): OrderRules | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as Partial<OrderRules>;
    const rules: OrderRules = {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
    const floor = num(o.seaFloorDoh);
    if (floor) rules.seaFloorDoh = floor;
    const cadence = num(o.seaCadenceDays);
    if (cadence) rules.seaCadenceDays = cadence;
    if (Array.isArray(o.airPeriods)) {
      const periods = o.airPeriods
        .map((p) => ({
          fromOffset: typeof p?.fromOffset === 'number' && Number.isFinite(p.fromOffset) ? Math.max(0, Math.round(p.fromOffset)) : NaN,
          minDoh: num(p?.minDoh) ?? NaN,
        }))
        .filter((p) => !Number.isNaN(p.fromOffset) && !Number.isNaN(p.minDoh))
        .slice(0, 6);
      if (periods.length > 0) rules.airPeriods = periods;
    }
    return Object.keys(rules).length > 0 ? rules : undefined;
  } catch {
    return undefined;
  }
}

export interface ModalQtySuggestion {
  /** Minimal air units to hold DOH ≥ threshold from the air arrival until the sea order
   *  lands (0 when sea arrives before any breach — i.e. no air needed). */
  airQty: number;
  /** Sea units (the monthly bulk) to top up to threshold + a cadence cover, so DOH
   *  stays ≥ threshold between monthly arrivals. */
  seaQty: number;
  /** Day offsets from today when each modal would arrive. */
  airArrival: number;
  seaArrival: number;
}

/**
 * Combined air+sea plan (the user's chosen model): AIR bridges the gap only until the
 * next monthly (1st-of-month) SEA order arrives; SEA is the bulk that sustains coverage.
 * Both target the DOH threshold — optionally time-varying for the air bridge
 * (`airFloorAt`, review 7b) and with a configurable sea cadence. Computed against the
 * projection that already includes the registered orders, so it's the INCREMENTAL
 * suggestion on top of what's placed.
 */
export function suggestModalQuantities(args: {
  projection: StockProjection;
  policy: SkuPolicy;
  today: string;
  dohThreshold: number;
  /** Days of cover beyond the floor for the sea bulk (periodicidade). Default 30. */
  seaCadenceDays?: number;
  /** Time-varying minimum-DOH floor for the air bridge; default = constant threshold. */
  airFloorAt?: (day: number) => number;
}): ModalQtySuggestion {
  const { projection, policy, today, dohThreshold } = args;
  const seaCadence = args.seaCadenceDays ?? 30;
  const tl = projection.timeline;
  const horizon = tl.length - 1;
  const seaDays = Math.max(0, Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS));
  const airDays = Math.max(0, Math.round(policy.leadTimeAirDays ?? INTERNATIONAL_AIR_LEAD_DAYS));

  const rateAt = (d: number) => forwardAvgDemand(tl, Math.max(0, Math.min(d, horizon)), 7);
  const stockAt = (d: number) => tl[Math.max(0, Math.min(d, horizon))]?.stock ?? 0;

  const airArrival = airDays;
  const seaArrival = diffDays(today, nextFirstOfMonth(today)) + seaDays;

  // Air bridge: the deepest shortfall below the (possibly time-varying) floor between
  // the air arrival and the sea arrival. 0 when sea lands before any breach.
  let airQty = 0;
  const bridgeEnd = Math.min(seaArrival, horizon);
  for (let d = airArrival; d <= bridgeEnd; d++) {
    const floor = args.airFloorAt ? args.airFloorAt(d) : dohThreshold;
    const need = floor * rateAt(d) - stockAt(d);
    if (need > airQty) airQty = need;
  }
  airQty = Math.max(0, Math.round(airQty));

  // Sea bulk: order-up-to (threshold + cadence) of cover at the sea arrival, so DOH
  // stays ≥ threshold across the cadence until the next monthly order.
  const seaLevel = (dohThreshold + seaCadence) * rateAt(seaArrival);
  const seaQty = Math.max(0, Math.round(seaLevel - stockAt(seaArrival)));

  return { airQty, seaQty, airArrival, seaArrival };
}

// ─── N-modal quantity engine (mega-rodada — generalizes the air/sea plan) ──────────
// Suppliers now expose N transport modals (Courier 15d / Aéreo 45d / Marítimo 105d…),
// each a lane with its own lead + DOH floor + optional recurring cadence. This
// generalizes the air-bridge/sea-bulk model to any number of lanes:
//   • Enabled modals ordered by arrival (fastest first).
//   • Every faster lane BRIDGES the gap from its arrival until the next lane's arrival,
//     holding DOH ≥ its own minDoh (deepest-shortfall, exactly the old air bridge).
//   • The SLOWEST enabled lane SUSTAINS: order-up-to (minDoh + cadence) of cover at its
//     arrival (exactly the old sea bulk).
// Reproduces suggestModalQuantities for 2 modals — minus the monthly sea anchor, which
// is gone: arrivals are plain lead offsets and the cadence is now a per-order parameter.

export interface ModalPlan {
  modal: ModalOption; // { id, name, leadDays } — leadDays already reflects any override
  /** Minimum DOH this lane must sustain in its window. */
  minDoh: number;
  /** Days of extra cover beyond minDoh for the SLOWEST lane (periodicidade). null/0 = one-time. */
  cadenceDays: number | null;
  enabled: boolean;
}

export interface ModalQty {
  modalId: string;
  modalName: string;
  qty: number;
  /** Arrival day offset from today (= the modal's lead). */
  arrivalOffset: number;
}

// The N-modal quantity engine itself lives in `miniStrip.ts` as `suggestCascadeQuantities`
// (seed-based): it RE-PROJECTS the floored walk after each lane, which a static-projection
// version can't do — see the note there. `ModalPlan`/`ModalQty` are defined here (the engine's
// vocabulary) and imported by the cascade.
