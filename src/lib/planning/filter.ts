// App-wide SKU "recorte": the hand-picked SELECTION is the single source of what the
// analyses see (when empty, the default scope applies). The old top-bar filter fields
// (models/category/q/withForecast, cookie `vg:filter`) were removed — filtering now
// lives ONLY on the SKUs page, locally, and the user materializes it into the
// selection ("selecionar visíveis"). The selection persists in chunked cookies.

export interface PlanningFilter {
  /** Hand-picked sku_bases (the recorte). Empty = no selection → default scope. */
  skus: string[];
}

/** Legacy cookie name — no longer read (kept only so old cookies can be cleared). */
export const FILTER_COOKIE = 'vg:filter';
export const EMPTY_FILTER: PlanningFilter = { skus: [] };

// The hand-picked selection can be large (hundreds of SKUs), which overflows a single
// ~4KB cookie. So it lives in its own compact, CHUNKED cookie set: base codes
// (URL-safe [A-Z0-9-]) joined by `~`, split across `vg:skus0..vg:skusN`.
// No JSON/percent-encoding overhead → ~140 codes per ~3.5KB chunk.
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

/** A recorte is active when the user hand-picked SKUs. */
export function isFilterActive(f: PlanningFilter): boolean {
  return f.skus.length > 0;
}
