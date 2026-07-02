import type { AbcClass } from '@/types/planning';

// Inventory-policy constants ported from leopardaelectric/spare-parts-forecast-lab
// (build_purchase_plan.py). Kept identical so the engine reproduces the lab's numbers.

/** Service-level Z by ABC class. */
export const ABC_Z: Record<AbcClass, number> = { A: 1.96, B: 1.65, C: 1.28 };

// ─── Global service-level tier (sub-project B1) ───────────────────────────────
// A single, mutable dial applied to EVERY SKU's safety stock at once (matches the
// reference tool's 95/97/99% floor buttons). When a tier is active it overrides the
// per-ABC ABC_Z above with one z for all SKUs. Labelled Base/Padrão/Conservador —
// deliberately NOT A/B/C, which already means the per-SKU importance class.
export type ServiceLevelTier = 'base' | 'padrao' | 'conservador';

/** z-score per tier: 95% → 1.645, 97% → 1.881, 99% → 2.326. */
export const SERVICE_LEVEL_Z: Record<ServiceLevelTier, number> = {
  base: 1.645,
  padrao: 1.881,
  conservador: 2.326,
};

/** Nominal service-level percentage per tier (for labels). */
export const SERVICE_LEVEL_PCT: Record<ServiceLevelTier, number> = {
  base: 95,
  padrao: 97,
  conservador: 99,
};

export const SERVICE_LEVEL_LABEL: Record<ServiceLevelTier, string> = {
  base: 'Base',
  padrao: 'Padrão',
  conservador: 'Conservador',
};

export const DEFAULT_SERVICE_LEVEL_TIER: ServiceLevelTier = 'base';

// The heatmap "low" coloring floor is no longer tied to the tier — it's the
// admin-configurable purchase criteria below (PurchaseCriteria). The tier now governs
// only the safety-stock z-score.

/** Key under which the active tier is stored in dev.fleet_global_settings. */
export const SERVICE_LEVEL_TIER_KEY = 'service_level_tier';

export function isServiceLevelTier(v: unknown): v is ServiceLevelTier {
  return v === 'base' || v === 'padrao' || v === 'conservador';
}

/** Target days-of-inventory by ABC class (order-up-to cover beyond lead time). */
export const ABC_TARGET_DOI: Record<AbcClass, number> = { A: 30, B: 45, C: 60 };

/** Procurement lead time when no per-SKU value is known (international parts, sea). */
export const DEFAULT_LEAD_TIME_DAYS = 110;

/** Default air-freight lead time for international parts (faster, costlier modal). */
export const INTERNATIONAL_AIR_LEAD_DAYS = 40;

/** Default planning horizon (days) for projections. Brief target = 150. */
export const HORIZON_DAYS = 150;

/** The forecast band (yhat_hi − yhat) approximates a one-sided 80% quantile ≈ 1.28σ;
 *  dividing the band by this recovers σ. */
export const BAND_Z = 1.28;

/** Elaboration trigger (sub-project B5): a SKU needs a new order when its projected
 *  DOH drops below this at any point in the horizon. Drives the Compras page, distinct
 *  from the statistical ROP. Default for the DOH-mode purchase criteria below. */
export const ELABORATION_DOH_THRESHOLD = 75;

// ─── Purchase / request criteria (admin-configurable) ─────────────────────────
// The rule that decides when a SKU needs a new order — drives BOTH the Compras
// "Novo Pedido" list AND the Semanas heatmap "low"/breach coloring, so they always
// agree. Two modes:
//   • 'doh' — request when projected coverage (DOH) drops below `dohThreshold`.
//   • 'rop' — request when projected stock drops below the reorder point
//             (estoque mínimo + estoque de segurança).
export type PurchaseCriteriaMode = 'doh' | 'rop';

export interface PurchaseCriteria {
  mode: PurchaseCriteriaMode;
  /** Coverage floor in days, used when mode = 'doh'. */
  dohThreshold: number;
}

/** Key under which the criteria is stored in dev.fleet_global_settings. */
export const PURCHASE_CRITERIA_KEY = 'purchase_criteria';

export const DEFAULT_PURCHASE_CRITERIA: PurchaseCriteria = {
  mode: 'doh',
  dohThreshold: ELABORATION_DOH_THRESHOLD,
};

/** Parse/validate a stored criteria value, falling back to the default. */
export function parsePurchaseCriteria(raw: unknown): PurchaseCriteria {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const mode: PurchaseCriteriaMode = o.mode === 'rop' ? 'rop' : 'doh';
    const doh = Number(o.dohThreshold);
    return {
      mode,
      dohThreshold: Number.isFinite(doh) && doh > 0 ? Math.round(doh) : DEFAULT_PURCHASE_CRITERIA.dohThreshold,
    };
  }
  return DEFAULT_PURCHASE_CRITERIA;
}
