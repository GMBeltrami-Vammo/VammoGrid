import 'server-only';
import type { SkuForecast } from '@/types/planning';
import { cachedChQuery } from '@/lib/clickhouse/reader';
import {
  coalesceForecasts,
  coalesceOne,
  maxAsOf,
  rowsToForecasts,
  rowsToOneForecast,
  type ForecastRow,
} from './forecastMerge';

// ─────────────────────────────────────────────────────────────────────────────
// Consume the upstream demand forecast, COALESCED per SKU across two models
// (decisions.MD #33):
//   • PRIMARY  ml_models_dev.spare_parts_consumption_forecast_daily — the corrected
//     consumption model. Preferred for any SKU it covers, regardless of relative
//     as_of staleness (the old S&OP model under-forecast some SKUs up to ~6x).
//   • FALLBACK dev.sop_predictions_daily — the S&OP forecast; a superset covering
//     every SKU, used wherever the primary has no series.
// We do not re-forecast — swapping the model = swapping the table / model_version,
// with no engine change. Column names differ (target_day vs target_date, klass vs
// abc_class); the SQL below aliases both into the uniform ForecastRow shape, and the
// pure merge in forecastMerge.ts tags provenance + resolves the per-SKU preference.
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_TABLE = 'ml_models_dev.spare_parts_consumption_forecast_daily';
const FALLBACK_TABLE = 'dev.sop_predictions_daily';

// The forecast only changes when a new model run lands (daily/weekly), so cache the
// row sets for 6h across requests/users; revalidateTag('forecast') busts BOTH reads.
const REVALIDATE = 21_600;
const TAGS = ['forecast'];

// PRIMARY: klass→abc_class, target_day→target_date; band collapses to yhat if missing.
// The rows are FILTERED in an alias-free inner subquery, THEN aliased in the outer SELECT.
// This is load-bearing: ClickHouse resolves a WHERE identifier to a same-name SELECT alias
// by default, so casting `toString(as_of_date) AS as_of_date` in the SAME select as
// `WHERE as_of_date = (SELECT max(as_of_date)…)` made the WHERE compare String vs Date and
// throw Code 386 NO_COMMON_TYPE on every request — silently degrading the whole app to
// S&OP-only (decisions.MD #37). Filtering before aliasing keeps the physical Date column in
// scope for the WHERE while still emitting the string-shaped ForecastRow.
function primarySql(innerWhere: string): string {
  return `
SELECT sku_base,
       toString(klass)         AS abc_class,
       toString(model_version) AS model_version,
       toString(as_of_date)    AS as_of_date,
       toString(target_day)    AS target_date,
       horizon_day,
       toFloat64(yhat)                             AS yhat,
       ifNull(toFloat64(yhat_lo), toFloat64(yhat)) AS lo,
       ifNull(toFloat64(yhat_hi), toFloat64(yhat)) AS hi
FROM (SELECT * FROM ${PRIMARY_TABLE} WHERE ${innerWhere})`;
}

const FALLBACK_SELECT = `
SELECT sku_base, abc_class, model_version, as_of_date, target_date, horizon_day,
       toFloat64(yhat)    AS yhat,
       toFloat64(yhat_lo) AS lo,
       toFloat64(yhat_hi) AS hi
FROM ${FALLBACK_TABLE}`;

const d10 = (v: unknown): string => String(v ?? '').slice(0, 10);
// Escape a value for a ClickHouse single-quoted literal: backslashes FIRST (ClickHouse
// honors C-style backslash escapes, so a leading backslash would otherwise defeat the
// quote-doubling and re-open the string), then single quotes.
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "''");

// True only for ClickHouse "table/database does not exist" — the ONLY error class the
// primary read may swallow (degrade to S&OP). Any other error (SQL/type/permission) must
// surface so a real regression is not masked as a silent total fallback (decisions.MD #37).
function isMissingTableError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNKNOWN_TABLE|UNKNOWN_DATABASE|Code:\s*(60|81)\b/.test(m);
}

// The primary table is optional infrastructure (a new ML output). If it is genuinely
// ABSENT, degrade GRACEFULLY to S&OP-only; any OTHER error re-throws so a real regression
// surfaces instead of silently running on the inferior model. The error is not cached
// (cachedChQuery re-throws), so a transient failure retries.
async function fetchPrimaryRows(extraWhere = ''): Promise<ForecastRow[]> {
  const sql = primarySql(`as_of_date = (SELECT max(as_of_date) FROM ${PRIMARY_TABLE})${extraWhere}`);
  try {
    return await cachedChQuery<ForecastRow>(sql, REVALIDATE, TAGS);
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(`[forecast] primary source ${PRIMARY_TABLE} absent — using S&OP fallback only.`);
      return [];
    }
    throw e;
  }
}

function fetchFallbackRows(extraWhere = ''): Promise<ForecastRow[]> {
  const sql = `${FALLBACK_SELECT}
WHERE as_of_date = (SELECT max(as_of_date) FROM ${FALLBACK_TABLE})${extraWhere}`;
  return cachedChQuery<ForecastRow>(sql, REVALIDATE, TAGS);
}

export interface ForecastBundle {
  bySku: Map<string, SkuForecast>;
  asOfDate: string;
}

/** Whole-catalog forecast, coalesced. bySku = primary-preferred per-SKU merge;
 *  asOfDate = the freshest run across both sources (per-SKU provenance is on each
 *  SkuForecast.source/asOfDate). */
export async function fetchForecasts(): Promise<ForecastBundle> {
  const [primaryRows, fallbackRows] = await Promise.all([fetchPrimaryRows(), fetchFallbackRows()]);
  const primary = rowsToForecasts(primaryRows, 'consumo-diario');
  const fallback = rowsToForecasts(fallbackRows, 'sop');
  return { bySku: coalesceForecasts(primary, fallback), asOfDate: maxAsOf(primary, fallback) };
}

// Single-SKU fast path (SKU deep-dive page): fetch + build ONE SkuForecast from each
// source for the selected SKU, then prefer primary. Cached per sku_base via the SQL key.
export async function fetchOneForecast(skuBase: string): Promise<SkuForecast | null> {
  if (!skuBase) return null;
  const where = ` AND sku_base = '${esc(skuBase)}'`;
  const [primaryRows, fallbackRows] = await Promise.all([fetchPrimaryRows(where), fetchFallbackRows(where)]);
  return coalesceOne(
    rowsToOneForecast(primaryRows, skuBase, 'consumo-diario'),
    rowsToOneForecast(fallbackRows, skuBase, 'sop'),
  );
}

// Historical run: the forecast for a SKU at a SPECIFIC as_of_date (previsão × realizado).
// Tries the consumption model at that as_of FIRST, then the S&OP table (which holds the
// deep as_of history; the consumption table currently has only its latest run). Returns
// null when neither has that run/SKU. Cached per (skuBase, asOfDate) via the SQL key.
export async function fetchForecastAsOf(skuBase: string, asOfDate: string): Promise<SkuForecast | null> {
  if (!skuBase || !asOfDate) return null;
  const safeSku = esc(skuBase);
  const safeAsOf = esc(asOfDate.slice(0, 10));
  const primaryQuery = primarySql(`as_of_date = '${safeAsOf}' AND sku_base = '${safeSku}'`);
  const fallbackQuery = `${FALLBACK_SELECT}
WHERE as_of_date = '${safeAsOf}' AND sku_base = '${safeSku}'`;
  const [primaryRows, fallbackRows] = await Promise.all([
    cachedChQuery<ForecastRow>(primaryQuery, REVALIDATE, TAGS).catch((e) => {
      if (isMissingTableError(e)) return [] as ForecastRow[];
      throw e;
    }),
    cachedChQuery<ForecastRow>(fallbackQuery, REVALIDATE, TAGS),
  ]);
  return coalesceOne(
    rowsToOneForecast(primaryRows, skuBase, 'consumo-diario'),
    rowsToOneForecast(fallbackRows, skuBase, 'sop'),
  );
}

// Lightweight forecast metadata (the UNION of sku_base that have a forecast in EITHER
// source + the latest as_of_date) for the SKU selector's "com previsão" filter + the
// freshness banner — without building the full forecast Map. Cheap DISTINCT queries.
export async function fetchForecastMeta(): Promise<{ skuBases: Set<string>; asOfDate: string }> {
  // The alias here is `as_of` (NOT as_of_date), so there is no WHERE-shadowing — this
  // query works; only the primarySql() paths needed the subquery restructure.
  const primaryMetaSql = `SELECT DISTINCT sku_base, toString(as_of_date) AS as_of
    FROM ${PRIMARY_TABLE}
    WHERE as_of_date = (SELECT max(as_of_date) FROM ${PRIMARY_TABLE})`;
  const fallbackMetaSql = `SELECT DISTINCT sku_base, toString(as_of_date) AS as_of
    FROM ${FALLBACK_TABLE}
    WHERE as_of_date = (SELECT max(as_of_date) FROM ${FALLBACK_TABLE})`;
  const [primaryRows, fallbackRows] = await Promise.all([
    cachedChQuery<{ sku_base: string; as_of: string }>(primaryMetaSql, REVALIDATE, TAGS).catch((e) => {
      if (isMissingTableError(e)) return [] as { sku_base: string; as_of: string }[];
      throw e;
    }),
    cachedChQuery<{ sku_base: string; as_of: string }>(fallbackMetaSql, REVALIDATE, TAGS),
  ]);
  const skuBases = new Set<string>();
  let asOfDate = '';
  for (const r of [...primaryRows, ...fallbackRows]) {
    skuBases.add(String(r.sku_base));
    const a = d10(r.as_of);
    if (a > asOfDate) asOfDate = a;
  }
  return { skuBases, asOfDate };
}
