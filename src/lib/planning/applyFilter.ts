import {
  FILTER_COOKIE,
  MAX_SKU_CHUNKS,
  SKU_CHUNK_PREFIX,
  encodeSkuChunks,
  type PlanningFilter,
} from './filter';

// Client-only helpers: persist the app-wide SKU filter so the next Server Component
// render (after router.refresh) narrows the dataset. Shared by every control that
// drives the filter (FilterBar, SkuTable, SkuFilterToggle…) so they all write the same
// shape and stay in sync.

// The small, fixed-shape part (models / category / q / withForecast) lives in the JSON
// `vg:filter` cookie. The hand-picked SKU selection is written separately by
// writeSkusCookies (it can be large → chunked compact cookies).
export function writeFilterCookie(next: PlanningFilter): void {
  const { models, category, q, withForecast } = next;
  const payload = JSON.stringify({ models, category, q, withForecast });
  document.cookie = `${FILTER_COOKIE}=${encodeURIComponent(payload)}; path=/; max-age=31536000`;
}

// Persist the hand-picked selection across the chunk cookies, clearing any leftover
// chunks from a previously larger selection.
export function writeSkusCookies(skus: string[]): void {
  const chunks = encodeSkuChunks(skus);
  for (let i = 0; i < MAX_SKU_CHUNKS; i++) {
    const name = `${SKU_CHUNK_PREFIX}${i}`;
    if (i < chunks.length) {
      document.cookie = `${name}=${chunks[i]}; path=/; max-age=31536000`;
    } else {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
}
