import 'server-only';
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

// The forecast is ~90 rows/SKU × hundreds of SKUs (tens of thousands of rows).
// The Metabase fallback caps native-query results at ~2000 rows, which would
// silently truncate the forecast to ~20 SKUs (and make every other SKU look
// zero-demand). Fetch in sku_base batches small enough to stay under any cap,
// in parallel, then merge. ~18 SKUs × 90 days ≈ 1620 rows per batch.
const FORECAST_BATCH_SKUS = 18;

async function fetchForecastRows(): Promise<ForecastRow[]> {
  const baseRows = await chQuery<{ sku_base: string }>(
    `SELECT DISTINCT sku_base FROM dev.sop_predictions_daily
     WHERE as_of_date = (SELECT max(as_of_date) FROM dev.sop_predictions_daily)`,
  );
  const bases = baseRows.map((r) => String(r.sku_base)).filter(Boolean);
  if (bases.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < bases.length; i += FORECAST_BATCH_SKUS) {
    batches.push(bases.slice(i, i + FORECAST_BATCH_SKUS));
  }
  const results = await Promise.all(
    batches.map((batch) => {
      const inList = batch.map((b) => `'${b.replace(/'/g, "''")}'`).join(',');
      return chQuery<ForecastRow>(`${FORECAST_SQL} AND sku_base IN (${inList})`);
    }),
  );
  return results.flat();
}

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
