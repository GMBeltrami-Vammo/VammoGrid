import type { AbcClass, SkuForecast, SkuPolicy, StockState } from '@/types/planning';
import type { SupplierKind } from '@/types';
import { ABC_TARGET_DOI, DEFAULT_LEAD_TIME_DAYS, INTERNATIONAL_AIR_LEAD_DAYS } from './constants';
import { NATIONAL_LEAD_TIMES } from './seed/nationalLeadTimes';

// Resolves the effective planning policy per SKU. Precedence:
//   ClickHouse dev.fleet_sku_policy override  →  national lead-time seed  →  ABC defaults.
// Until the sku_policy table is populated, every SKU gets sensible defaults
// (national parts get their known lead time; everything else 110d international).

const DEFAULT_RECOVERY_TURNAROUND_DAYS = 14;

/**
 * Effective lead time (days) for a SKU — the same value buildPolicies resolves into
 * SkuPolicy.leadTimeDays. Precedence: explicit override.leadTimeDays → modal-aware
 * sea/air (override or seed/default) → national seed → DEFAULT_LEAD_TIME_DAYS (110).
 * Exported so the orders sync can compute ETA = order_date + this, using the planning
 * lead times rather than whatever the upstream feed carries.
 */
export function effectiveLeadDays(skuBase: string, override?: Partial<SkuPolicy>): number {
  const national = NATIONAL_LEAD_TIMES[skuBase];
  const seaBase = national ?? DEFAULT_LEAD_TIME_DAYS;
  const airBase = national ?? INTERNATIONAL_AIR_LEAD_DAYS;
  if (!override) return seaBase;
  if (override.leadTimeDays != null) return override.leadTimeDays;
  const sea = override.leadTimeSeaDays ?? seaBase;
  const air = override.leadTimeAirDays ?? airBase;
  return (override.defaultModal ?? 'sea') === 'air' ? air : sea;
}

export function defaultPolicyFor(
  skuBase: string,
  stock: StockState,
  abcClass: AbcClass,
  nowIso: string,
): SkuPolicy {
  const national = NATIONAL_LEAD_TIMES[skuBase];
  // National parts ship domestically (modal moot → sea = air = the seed). International
  // parts default to sea (110d) with a faster air option (40d).
  const seaDays = national ?? DEFAULT_LEAD_TIME_DAYS;
  const airDays = national ?? INTERNATIONAL_AIR_LEAD_DAYS;
  return {
    skuBase,
    leadTimeDays: seaDays, // defaultModal = 'sea'
    leadTimeSource: national != null ? 'national-file' : 'international-default',
    leadTimeSeaDays: seaDays,
    leadTimeAirDays: airDays,
    defaultModal: 'sea',
    leadTimeStdDays: null,
    abcClass,
    targetDoi: ABC_TARGET_DOI[abcClass],
    recoveryRate: 0,
    recoveryTurnaroundDays: DEFAULT_RECOVERY_TURNAROUND_DAYS,
    safetyOverride: null,
    isRepairable: stock.isRepairable,
    updatedBy: null,
    updatedAt: nowIso,
  };
}

/** Lead time (+ origin) a preferred supplier contributes to its SKUs. */
export interface SupplierLead {
  kind: SupplierKind;
  sea: number | null;
  air: number | null;
}

/**
 * Override each SKU's lead times from its preferred supplier — lead time is now a
 * supplier attribute (VMoto 105 mar / 45 aéreo). Precedence: the preferred supplier's
 * sea/air (when set) → the SKU's existing policy lead (fallback for SKUs with no
 * supplier, or a supplier with no lead). Also aligns leadTimeSource with the supplier
 * kind so the nacional/internacional label follows the supplier. Pure; returns a new map.
 */
export function applySupplierLeadTimes(
  policies: Map<string, SkuPolicy>,
  leadBySku: Map<string, SupplierLead>,
): Map<string, SkuPolicy> {
  const out = new Map(policies);
  for (const [sku, pol] of out) {
    const sup = leadBySku.get(sku);
    if (!sup || (sup.sea == null && sup.air == null)) continue; // no supplier lead → keep the SKU's
    const sea = sup.sea ?? pol.leadTimeSeaDays;
    const air = sup.air ?? pol.leadTimeAirDays;
    const eff = (pol.defaultModal === 'air' ? air : sea) ?? pol.leadTimeDays;
    out.set(sku, {
      ...pol,
      leadTimeSeaDays: sea,
      leadTimeAirDays: air,
      leadTimeDays: Math.max(0, Math.round(eff)),
      leadTimeSource: sup.kind === 'nacional' ? 'national-file' : 'international-default',
    });
  }
  return out;
}

export function buildPolicies(args: {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  overrides?: Map<string, Partial<SkuPolicy>>;
  nowIso: string;
}): Map<string, SkuPolicy> {
  const map = new Map<string, SkuPolicy>();
  for (const s of args.stocks) {
    const abc = args.forecasts.get(s.skuBase)?.abcClass ?? 'C';
    const base = defaultPolicyFor(s.skuBase, s, abc, args.nowIso);
    const ov = args.overrides?.get(s.skuBase);
    if (!ov) {
      map.set(s.skuBase, base);
      continue;
    }
    const abcFinal = ov.abcClass ?? base.abcClass;
    const merged: SkuPolicy = {
      ...base,
      ...ov,
      abcClass: abcFinal,
      targetDoi: ov.targetDoi ?? ABC_TARGET_DOI[abcFinal],
      // Effective lead time: explicit override → modal-aware sea/air → seed → default.
      leadTimeDays: effectiveLeadDays(s.skuBase, ov),
    };
    map.set(s.skuBase, merged);
  }
  return map;
}
