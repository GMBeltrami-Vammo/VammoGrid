import type { AbcClass } from '@/types/planning';

// Inventory-policy constants ported from leopardaelectric/spare-parts-forecast-lab
// (build_purchase_plan.py). Kept identical so the engine reproduces the lab's numbers.

/** Service-level Z by ABC class. */
export const ABC_Z: Record<AbcClass, number> = { A: 1.96, B: 1.65, C: 1.28 };

/** Target days-of-inventory by ABC class (order-up-to cover beyond lead time). */
export const ABC_TARGET_DOI: Record<AbcClass, number> = { A: 30, B: 45, C: 60 };

/** Procurement lead time when no per-SKU value is known (international parts). */
export const DEFAULT_LEAD_TIME_DAYS = 110;

/** Default planning horizon (days) for projections. Brief target = 150. */
export const HORIZON_DAYS = 150;

/** The forecast band (yhat_hi − yhat) approximates a one-sided 80% quantile ≈ 1.28σ;
 *  dividing the band by this recovers σ. */
export const BAND_Z = 1.28;
