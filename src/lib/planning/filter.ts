import type { StockState } from '@/types/planning';

// App-wide SKU filter, persisted in the `vg:filter` cookie so Server Components can
// read it and narrow the dataset before the engines run. Bike models come from
// part_compat; category from the warehouse (BIKE/BATTERY/BOX); q is free text.

export interface PlanningFilter {
  models: string[];
  category: string | null;
  q: string;
}

export const FILTER_COOKIE = 'vg:filter';
export const EMPTY_FILTER: PlanningFilter = { models: [], category: null, q: '' };

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
      models: Array.isArray(o.models) ? o.models.map(String) : [],
      category: o.category ? String(o.category) : null,
      q: typeof o.q === 'string' ? o.q : '',
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function isFilterActive(f: PlanningFilter): boolean {
  return f.models.length > 0 || f.category != null || f.q.trim().length > 0;
}

export function skuPasses(
  f: PlanningFilter,
  stock: StockState,
  compatModels: Map<string, Set<string>>,
): boolean {
  if (f.category && stock.category !== f.category) return false;
  if (f.q.trim()) {
    const n = f.q.trim().toLowerCase();
    if (!stock.skuName.toLowerCase().includes(n) && !stock.skuBase.toLowerCase().includes(n)) {
      return false;
    }
  }
  if (f.models.length > 0) {
    const set = compatModels.get(stock.skuBase);
    if (!set || !f.models.some((m) => set.has(m))) return false;
  }
  return true;
}
