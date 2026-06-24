import { FILTER_COOKIE, type PlanningFilter } from './filter';

// Client-only helper: persist the app-wide SKU filter to the `vg:filter` cookie so
// the next Server Component render (after router.refresh) narrows the dataset.
// Shared by every control that drives the app-wide filter (FilterBar, SkuTable…)
// so they all write the same shape and stay in sync.
export function writeFilterCookie(next: PlanningFilter): void {
  document.cookie = `${FILTER_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000`;
}
