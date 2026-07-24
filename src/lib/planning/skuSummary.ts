import 'server-only';
import type { ForecastSource, ProjectionPoint } from '@/types/planning';
import { loadSkuView } from './load';
import { projectSku, computeArrivals, type PoArrival } from './projection';
import { fetchStockHistory } from './source/history';
import { fetchPurchaseCriteria } from './source/globalSettings';
import { fetchFleetInfoRows } from './source/fleetInfo';
import { fetchFleetWeeklySizes } from './source/fleetSizeWeekly';
import { fetchDailyConsumption } from './source/consumption';
import { buildNaiveComparisons, consumptionByDate, mapFleetSegments } from './naiveEngines';
import { sampleMiniStrip, type MiniCell } from './miniStrip';
import { resolveShares } from './allocation';
import { defaultPolicyFor } from './policy';
import { addDays, diffDays } from './dates';
import { HORIZON_DAYS } from './constants';

// Slim, serializable payload for the app-wide SKU popup (Feature D / decisions.MD #36).
// Reuses the SKU deep-dive building blocks (loadSkuView + projectSku + fetchStockHistory
// + the naive comparison engines + the mini-strip) WITHOUT recomputing the whole
// snapshot per click. Consumed by GET /api/fleet/sku-summary and the SkuPopup component.

export interface SkuSummary {
  found: boolean;
  skuBase: string;
  skuName: string;
  today: string;
  provenance: { source: ForecastSource | null; asOfDate: string | null; modelVersion: string | null };
  kpis: {
    stock: number;
    dohNow: number | null;
    dailyDemand: number;
    isRepairable: boolean;
    recoveryRate: number;
    recoveryTurnaroundDays: number;
    stockoutDate: string | null;
  };
  /** Real stock history (≈ last 7d, strictly before today) for the chart's left half. */
  history: { date: string; stock: number }[];
  /** Global projection D0 → D+30 (the popup's focused window). */
  projection: ProjectionPoint[];
  /** Full-horizon global timeline — the DOH denominator for the windowed chart. */
  rateSource: ProjectionPoint[];
  /** Faded L30/L90 comparison lines (global), sliced to the D+30 window. */
  comparisons: { label: string; color: string; timeline: ProjectionPoint[] }[];
  /** Next-8-weeks DOH strip (offsets 0,7,…,49), coloured by the purchase criteria floor. */
  strip: MiniCell[];
  criteriaFloor: number;
  /** Open-PO arrivals within the D+30 window (markers on the chart). */
  arrivals: PoArrival[];
}

const WINDOW_DAYS = 30;
const STRIP_WEEKS = [0, 7, 14, 21, 28, 35, 42, 49];

function empty(sku: string, today: string): SkuSummary {
  return {
    found: false,
    skuBase: sku,
    skuName: sku,
    today,
    provenance: { source: null, asOfDate: null, modelVersion: null },
    kpis: { stock: 0, dohNow: null, dailyDemand: 0, isRepairable: false, recoveryRate: 0, recoveryTurnaroundDays: 0, stockoutDate: null },
    history: [],
    projection: [],
    rateSource: [],
    comparisons: [],
    strip: [],
    criteriaFloor: 0,
    arrivals: [],
  };
}

export async function buildSkuSummary(sku: string): Promise<SkuSummary> {
  const { inputs, selected } = await loadSkuView(sku);
  const today = inputs.today;
  const selStock = inputs.stocks.find((s) => s.skuBase === selected);
  // loadSkuView falls back to the FIRST catalog SKU when `sku` matches nothing (intended
  // for the Estoque page's visible selector). For the popup/API that would silently show a
  // DIFFERENT SKU's data as found:true — so require an exact match here (decisions.MD #37).
  if (!selected || selected !== sku || !selStock) return empty(sku, today);

  const forecast = inputs.forecasts.get(selected) ?? null;
  const orders = inputs.ordersBySku.get(selected) ?? [];
  const policy =
    inputs.policies.get(selected) ??
    defaultPolicyFor(selected, selStock, forecast?.abcClass ?? 'C', today);
  const shares = resolveShares(selStock, inputs.shares.get(selected));
  const from90 = addDays(today, -90);

  const [history, criteria, fleetRows, weeklyRows, consumptionRows] = await Promise.all([
    fetchStockHistory(selStock.skuBase, selStock.byHub, 7),
    fetchPurchaseCriteria(),
    fetchFleetInfoRows(),
    fetchFleetWeeklySizes(),
    fetchDailyConsumption(selStock.skuBase, from90, today),
  ]);

  const projections = projectSku({ stock: selStock, forecast, orders, policy, shares, today });
  const criteriaFloor = criteria.dohThreshold;

  const comparisons = buildNaiveComparisons({
    skuBase: selected,
    stock: selStock,
    orders,
    policy,
    shares,
    today,
    horizonDays: HORIZON_DAYS,
    models: inputs.compatModels.get(selected),
    fleetSegments: mapFleetSegments(fleetRows, weeklyRows, today),
    consumption: consumptionByDate(consumptionRows),
  }).map((c) => ({ label: c.label, color: c.color, timeline: c.projections.global.timeline.slice(0, WINDOW_DAYS + 1) }));

  // All future arrivals: the chart self-filters to its D+30 window; the 8-week mini-strip
  // needs the wider set. Open POs are few, so no upper bound is needed.
  const arrivals = computeArrivals(orders, today).filter((a) => diffDays(today, a.date) >= 0);

  return {
    found: true,
    skuBase: selected,
    skuName: selStock.skuName,
    today,
    provenance: {
      source: forecast?.source ?? null,
      asOfDate: forecast?.asOfDate ?? null,
      modelVersion: forecast?.modelVersion ?? null,
    },
    kpis: {
      stock: selStock.total,
      dohNow: projections.global.dohNow,
      dailyDemand: projections.global.dailyDemand,
      isRepairable: policy.isRepairable,
      recoveryRate: policy.recoveryRate,
      recoveryTurnaroundDays: policy.recoveryTurnaroundDays,
      stockoutDate: projections.global.stockoutDate,
    },
    history: history.global,
    projection: projections.global.timeline.slice(0, WINDOW_DAYS + 1),
    rateSource: projections.global.timeline,
    comparisons,
    strip: sampleMiniStrip(projections.global, STRIP_WEEKS, criteriaFloor),
    criteriaFloor,
    arrivals,
  };
}
