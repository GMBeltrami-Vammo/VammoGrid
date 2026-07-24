import type { AbcClass, ForecastPoint, ForecastSource, SkuForecast } from '@/types/planning';

// ─────────────────────────────────────────────────────────────────────────────
// Pure forecast row → SkuForecast grouping + per-SKU coalesce across the two
// upstream models. NO server-only / next-cache imports, so this is unit-testable
// directly. The I/O (SQL + caching) lives in source/forecast.ts, which calls these.
//
// The two source tables have different column names (target_day vs target_date,
// klass vs abc_class); the SQL in source/forecast.ts aliases both into this single
// uniform ForecastRow shape before it reaches here. See decisions.MD #33.
// ─────────────────────────────────────────────────────────────────────────────

/** A forecast row AFTER SQL aliasing — uniform across both source tables. */
export interface ForecastRow {
  sku_base: string;
  abc_class: string;
  model_version: string;
  as_of_date: string;
  target_date: string;
  horizon_day: number | string;
  yhat: number | string;
  lo: number | string | null;
  hi: number | string | null;
}

const d10 = (v: unknown): string => String(v ?? '').slice(0, 10);
const asAbc = (s: string): AbcClass => (s === 'A' || s === 'B' ? s : 'C');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Group aliased rows into one SkuForecast per sku_base, tagging provenance `source`. */
export function rowsToForecasts(rows: ForecastRow[], source: ForecastSource): Map<string, SkuForecast> {
  const bySku = new Map<string, SkuForecast>();
  for (const r of rows) {
    const skuBase = String(r.sku_base ?? '');
    if (!skuBase) continue;
    let fc = bySku.get(skuBase);
    if (!fc) {
      fc = {
        skuBase,
        asOfDate: d10(r.as_of_date),
        abcClass: asAbc(String(r.abc_class ?? '')),
        modelVersion: String(r.model_version ?? ''),
        horizonDays: 0,
        points: [],
        source,
      };
      bySku.set(skuBase, fc);
    }
    const day = num(r.horizon_day);
    const yhat = num(r.yhat);
    // Defensive band: a missing/blank lo|hi collapses to the point (zero-width band)
    // rather than 0 — a 0 lower band would render an absurd "optimistic floor of 0".
    const lo = r.lo == null || r.lo === '' ? yhat : num(r.lo);
    const hi = r.hi == null || r.hi === '' ? yhat : num(r.hi);
    const point: ForecastPoint = { day, date: d10(r.target_date), yhat, lo, hi };
    fc.points.push(point);
    if (day > fc.horizonDays) fc.horizonDays = day;
  }
  for (const fc of bySku.values()) fc.points.sort((a, b) => a.day - b.day);
  return bySku;
}

/** Build ONE forecast for a single sku_base (single-SKU fast path). */
export function rowsToOneForecast(
  rows: ForecastRow[],
  skuBase: string,
  source: ForecastSource,
): SkuForecast | null {
  return rowsToForecasts(rows, source).get(skuBase) ?? null;
}

/** Per-SKU coalesce: the PRIMARY (consumption) model ALWAYS wins when a SKU is present
 *  — regardless of relative as_of staleness (locked decision #33); every other SKU
 *  falls back to the S&OP series, which is a superset covering the whole catalog. */
export function coalesceForecasts(
  primary: Map<string, SkuForecast>,
  fallback: Map<string, SkuForecast>,
): Map<string, SkuForecast> {
  const bySku = new Map<string, SkuForecast>(fallback);
  for (const [sku, fc] of primary) bySku.set(sku, fc);
  return bySku;
}

/** Coalesce ONE SKU: prefer the primary series when it has one, else the fallback,
 *  else null. Used by the single-SKU fast paths (deep-dive page, prev×real). */
export function coalesceOne(
  primary: SkuForecast | null,
  fallback: SkuForecast | null,
): SkuForecast | null {
  return primary ?? fallback ?? null;
}

/** Freshest as_of across the given forecast maps — the coarse bundle-level "data as of"
 *  banner date (per-SKU provenance rides on each SkuForecast.asOfDate/source). */
export function maxAsOf(...maps: Map<string, SkuForecast>[]): string {
  let max = '';
  for (const m of maps) for (const fc of m.values()) if (fc.asOfDate > max) max = fc.asOfDate;
  return max;
}
