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

// The hand-picked selection can be large (hundreds of SKUs), which overflows a single
// ~4KB cookie. So it lives OUTSIDE the JSON `vg:filter` cookie, in its own compact,
// CHUNKED cookie set: base codes (URL-safe [A-Z0-9-]) joined by `~`, split across
// `vg:skus0..vg:skusN`. No JSON/percent-encoding overhead → ~140 codes per ~3.5KB chunk.
export const SKU_CHUNK_PREFIX = 'vg:skus';
export const MAX_SKU_CHUNKS = 8;
const SKU_DELIM = '~';
const CHUNK_BUDGET = 3500; // bytes per cookie value (safe under the ~4KB limit)

/** Upper bound on the selection, matched to the chunk capacity above (~8 × ~140). */
export const MAX_SELECTED_SKUS = 1000;

/** Server-side: join the chunk cookie values back into the sku_base list. */
export function decodeSkuChunks(values: (string | undefined | null)[]): string[] {
  const joined = values.filter(Boolean).join(SKU_DELIM);
  if (!joined) return [];
  return joined.split(SKU_DELIM).map((s) => s.trim()).filter(Boolean);
}

/** Client-side: pack the selection into ≤ MAX_SKU_CHUNKS compact chunk strings. */
export function encodeSkuChunks(skus: string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const s of skus) {
    const next = cur ? `${cur}${SKU_DELIM}${s}` : s;
    if (next.length > CHUNK_BUDGET && cur) {
      chunks.push(cur);
      cur = s;
      if (chunks.length >= MAX_SKU_CHUNKS) return chunks;
    } else {
      cur = next;
    }
  }
  if (cur && chunks.length < MAX_SKU_CHUNKS) chunks.push(cur);
  return chunks;
}

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
      // `skus` no longer lives in this cookie — it's read from the chunk cookies and
      // merged in by the loader. Ignore any legacy value here.
      skus: [],
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
