import type { AbcClass, SkuForecast, SkuPolicy, StockState } from '@/types/planning';
import { ABC_TARGET_DOI, DEFAULT_LEAD_TIME_DAYS } from './constants';
import { NATIONAL_LEAD_TIMES } from './seed/nationalLeadTimes';

// Resolves the effective planning policy per SKU. Precedence:
//   Supabase sku_policy override  →  national lead-time seed  →  ABC defaults.
// Until the sku_policy table is populated, every SKU gets sensible defaults
// (national parts get their known lead time; everything else 110d international).

const DEFAULT_RECOVERY_TURNAROUND_DAYS = 14;

export function defaultPolicyFor(
  skuBase: string,
  stock: StockState,
  abcClass: AbcClass,
  nowIso: string,
): SkuPolicy {
  const national = NATIONAL_LEAD_TIMES[skuBase];
  return {
    skuBase,
    leadTimeDays: national ?? DEFAULT_LEAD_TIME_DAYS,
    leadTimeSource: national != null ? 'national-file' : 'international-default',
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
    map.set(s.skuBase, {
      ...base,
      ...ov,
      abcClass: abcFinal,
      targetDoi: ov.targetDoi ?? ABC_TARGET_DOI[abcFinal],
    });
  }
  return map;
}
