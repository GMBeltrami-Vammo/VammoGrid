import 'server-only';
import { unstable_cache } from 'next/cache';
import type { AbcClass, ForecastPoint, SkuForecast } from '@/types/planning';
import { chQuery } from '@/lib/clickhouse/reader';

// Consume the upstream demand forecast (dev.sop_predictions_daily) at its latest run.
// Fleet-level daily yhat/lo/hi per sku_base; we do not re-forecast — swapping the
// model = swapping this table / model_version, with no engine change.

interface ForecastRow {
  sku_base: string;
  abc_class: string;
  model_version: string;
  as_of_date: string;
  target_date: string;
  horizon_day: number | string;
  yhat: number | string;
  lo: number | string;
  hi: number | string;
}

const FORECAST_SQL = `
SELECT sku_base, abc_class, model_version, as_of_date, target_date,
       horizon_day,
       toFloat64(yhat)    AS yhat,
       toFloat64(yhat_lo) AS lo,
       toFloat64(yhat_hi) AS hi
FROM dev.sop_predictions_daily
WHERE as_of_date = (SELECT max(as_of_date) FROM dev.sop_predictions_daily)`;

// The forecast is ~90 rows/SKU × hundreds of SKUs (tens of thousands of rows) — one
// query on direct ClickHouse (no row cap). It only changes when a new model run lands
// (daily/weekly), so cache the whole row set for an hour across requests;
// revalidateTag('forecast') to bust.
const fetchForecastRows = unstable_cache(
  () => chQuery<ForecastRow>(FORECAST_SQL),
  ['forecast-rows'],
  { revalidate: 21600, tags: ['forecast'] },
);

function asAbc(s: string): AbcClass {
  return s === 'A' || s === 'B' ? s : 'C';
}

const d10 = (v: unknown) => String(v ?? '').slice(0, 10);

export interface ForecastBundle {
  bySku: Map<string, SkuForecast>;
  asOfDate: string;
}

export async function fetchForecasts(): Promise<ForecastBundle> {
  const rows = await fetchForecastRows();

  const bySku = new Map<string, SkuForecast>();
  let asOfDate = '';

  for (const r of rows) {
    const skuBase = String(r.sku_base);
    const asOf = d10(r.as_of_date);
    if (asOf > asOfDate) asOfDate = asOf;

    let fc = bySku.get(skuBase);
    if (!fc) {
      fc = {
        skuBase,
        asOfDate: asOf,
        abcClass: asAbc(String(r.abc_class)),
        modelVersion: String(r.model_version),
        horizonDays: 0,
        points: [],
      };
      bySku.set(skuBase, fc);
    }
    const day = Number(r.horizon_day) || 0;
    const point: ForecastPoint = {
      day,
      date: d10(r.target_date),
      yhat: Number(r.yhat) || 0,
      lo: Number(r.lo) || 0,
      hi: Number(r.hi) || 0,
    };
    fc.points.push(point);
    if (day > fc.horizonDays) fc.horizonDays = day;
  }

  for (const fc of bySku.values()) fc.points.sort((a, b) => a.day - b.day);
  return { bySku, asOfDate };
}

function rowToForecast(rows: ForecastRow[], skuBase: string): SkuForecast | null {
  if (rows.length === 0) return null;
  const fc: SkuForecast = {
    skuBase,
    asOfDate: d10(rows[0].as_of_date),
    abcClass: asAbc(String(rows[0].abc_class)),
    modelVersion: String(rows[0].model_version),
    horizonDays: 0,
    points: [],
  };
  for (const r of rows) {
    const day = Number(r.horizon_day) || 0;
    fc.points.push({
      day,
      date: d10(r.target_date),
      yhat: Number(r.yhat) || 0,
      lo: Number(r.lo) || 0,
      hi: Number(r.hi) || 0,
    });
    if (day > fc.horizonDays) fc.horizonDays = day;
  }
  fc.points.sort((a, b) => a.day - b.day);
  return fc;
}

// Single-SKU fast path: fetch + build ONE SkuForecast (≈90 rows, one query — no
// materializing the whole catalog). For the SKU deep-dive page, which only needs
// the selected SKU. Cached per sku_base.
export async function fetchOneForecast(skuBase: string): Promise<SkuForecast | null> {
  if (!skuBase) return null;
  const safe = skuBase.replace(/'/g, "''");
  const rows = await unstable_cache(
    () => chQuery<ForecastRow>(`${FORECAST_SQL} AND sku_base = '${safe}'`),
    ['forecast-one', skuBase],
    { revalidate: 21600, tags: ['forecast'] },
  )();
  return rowToForecast(rows, skuBase);
}

// Historical run: the forecast for a SKU at a SPECIFIC as_of_date (review 8 fase 2 —
// previsão × realizado). Unlike fetchOneForecast (pinned to max as_of), this reads the
// frozen run stored on a pedido's elaboration_snapshot. Returns null if that run/SKU
// isn't in the table. Cached per (skuBase, asOfDate).
export async function fetchForecastAsOf(skuBase: string, asOfDate: string): Promise<SkuForecast | null> {
  if (!skuBase || !asOfDate) return null;
  const safeSku = skuBase.replace(/'/g, "''");
  const safeAsOf = asOfDate.slice(0, 10).replace(/'/g, "''");
  const rows = await unstable_cache(
    () =>
      chQuery<ForecastRow>(
        `SELECT sku_base, abc_class, model_version, as_of_date, target_date, horizon_day,
                toFloat64(yhat) AS yhat, toFloat64(yhat_lo) AS lo, toFloat64(yhat_hi) AS hi
         FROM dev.sop_predictions_daily
         WHERE as_of_date = '${safeAsOf}' AND sku_base = '${safeSku}'`,
      ),
    ['forecast-asof', skuBase, safeAsOf],
    { revalidate: 21600, tags: ['forecast'] },
  )();
  return rowToForecast(rows, skuBase);
}

// Lightweight forecast metadata (the set of sku_base that have a forecast + the latest
// as_of_date) for the SKU selector's "com previsão" filter + the freshness banner —
// without building the full forecast Map. One cheap DISTINCT query, cached.
export async function fetchForecastMeta(): Promise<{ skuBases: Set<string>; asOfDate: string }> {
  const rows = await unstable_cache(
    () =>
      chQuery<{ sku_base: string; as_of: string }>(
        `SELECT DISTINCT sku_base, toString(as_of_date) AS as_of
         FROM dev.sop_predictions_daily
         WHERE as_of_date = (SELECT max(as_of_date) FROM dev.sop_predictions_daily)`,
      ),
    ['forecast-meta'],
    { revalidate: 21600, tags: ['forecast'] },
  )();
  const skuBases = new Set<string>();
  let asOfDate = '';
  for (const r of rows) {
    skuBases.add(String(r.sku_base));
    const a = d10(r.as_of);
    if (a > asOfDate) asOfDate = a;
  }
  return { skuBases, asOfDate };
}
