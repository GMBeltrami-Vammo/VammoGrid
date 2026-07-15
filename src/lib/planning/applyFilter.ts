import { FILTER_COOKIE, MAX_SKU_CHUNKS, SKU_CHUNK_PREFIX, encodeSkuChunks } from './filter';

// Client-only helpers: persist the hand-picked SKU selection (the app-wide recorte)
// so the next Server Component render (after router.refresh) narrows the dataset.
// Shared by every control that drives the selection (SkuTable, SkuFilterToggle,
// FilterBar chip, presets…).

// Persist the hand-picked selection across the chunk cookies, clearing any leftover
// chunks from a previously larger selection. Also clears the LEGACY `vg:filter`
// cookie (the old top-bar filter) so stale values never linger.
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
  document.cookie = `${FILTER_COOKIE}=; path=/; max-age=0`;
}
