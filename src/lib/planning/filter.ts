import type { StockState } from '@/types/planning';
import { BIKE_MODELS } from '@/types';

// App-wide SKU filter, persisted in the `vg:filter` cookie so Server Components can
// read it and narrow the dataset before the engines run. Bike models come from
// part_compat; category from the warehouse (BIKE/BATTERY/BOX); q is free text.

const VALID_MODELS: ReadonlySet<string> = new Set(BIKE_MODELS);

export interface PlanningFilter {
  models: string[];
  category: string | null;
  q: string;
  /** Hand-picked sku_bases (single-SKU focus set). Empty = no selection. When
   *  non-empty, only these SKUs pass — narrows every aggregate analysis. */
  skus: string[];
  /** Show only SKUs that have a demand forecast (dev.sop_predictions_daily).
   *  Applied in loadPlanningInputs (needs the forecast map), not in skuPasses. */
  withForecast: boolean;
}

export const FILTER_COOKIE = 'vg:filter';
export const EMPTY_FILTER: PlanningFilter = {
  models: [],
  category: null,
  q: '',
  skus: [],
  withForecast: false,
};

/** Cap on the hand-picked set, to keep the cookie well under the ~4KB limit
 *  (a 15-char sku_base encodes to ~24 bytes in the cookie → 100 ≈ 2.4KB). */
export const MAX_SELECTED_SKUS = 100;

export function parseFilterCookie(raw: string | undefined): PlanningFilter {
  if (!raw) return EMPTY_FILTER;
  let txt = raw;
  try {
    txt = decodeURIComponent(raw);
  } catch {
    /* value wasn't percent-encoded */
  }
  try {
    const o = JSON.parse(txt) as Partial<PlanningFilter>;
    return {
      // Drop stale model keys (e.g. the pre-consolidation `cpx_preta` after models
      // collapsed to cpx/comfort) — otherwise a stale cookie matches NO SKU and
      // silently empties every scoped page.
      models: Array.isArray(o.models) ? o.models.map(String).filter((m) => VALID_MODELS.has(m)) : [],
      category: o.category ? String(o.category) : null,
      q: typeof o.q === 'string' ? o.q : '',
      skus: Array.isArray(o.skus) ? o.skus.map(String) : [],
      withForecast: o.withForecast === true,
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function isFilterActive(f: PlanningFilter): boolean {
  return (
    f.models.length > 0 ||
    f.category != null ||
    f.q.trim().length > 0 ||
    f.skus.length > 0 ||
    f.withForecast
  );
}

export function skuPasses(
  f: PlanningFilter,
  stock: StockState,
  compatModels: Map<string, Set<string>>,
): boolean {
  // Hand-picked focus set: only the selected sku_bases pass (composes AND with the
  // scope filters below).
  if (f.skus.length > 0 && !f.skus.includes(stock.skuBase)) return false;
  if (f.category && stock.category !== f.category) return false;
  if (f.q.trim()) {
    const n = f.q.trim().toLowerCase();
    if (!stock.skuName.toLowerCase().includes(n) && !stock.skuBase.toLowerCase().includes(n)) {
      return false;
    }
  }
  // Fail-open when no compat data is loaded (empty map = table not yet seeded):
  // hiding ALL SKUs when the user selects a model is confusing and unhelpful.
  if (f.models.length > 0 && compatModels.size > 0) {
    const set = compatModels.get(stock.skuBase);
    if (!set || !f.models.some((m) => set.has(m))) return false;
  }
  return true;
}
