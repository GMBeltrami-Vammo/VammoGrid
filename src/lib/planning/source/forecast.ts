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

function asAbc(s: string): AbcClass {
  return s === 'A' || s === 'B' ? s : 'C';
}

const d10 = (v: unknown) => String(v ?? '').slice(0, 10);

export interface ForecastBundle {
  bySku: Map<string, SkuForecast>;
  asOfDate: string;
}

export async function fetchForecasts(): Promise<ForecastBundle> {
  const rows = await chQuery<ForecastRow>(FORECAST_SQL);

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
