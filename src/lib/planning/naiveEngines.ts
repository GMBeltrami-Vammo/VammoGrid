import type { SkuForecast } from '@/types/planning';
import { addDays, diffDays } from './dates';
import { buildFleetDailySeries, type FleetControlPoint } from './fleetGrowth';

// ─────────────────────────────────────────────────────────────────────────────
// L30 / L90 naive comparison engines (Feature C / decisions.MD #35). COMPARISON
// ONLY — these NEVER feed ordering, elaboration, cascade, heatmap coloring, decision
// DOH, or any suggestion. They exist purely as faded reference lines to eyeball the
// ML model against naive per-bike baselines.
//
//   rate_L30 = mean over the last 30 calendar days d of consumption(d) / fleet(d)
//   rate_L90 = same over 90 days
//
// Zero-consumption days COUNT as rate 0 (average over ALL days in the window). Days
// with fleet ≤ 0 are skipped. Mean of DAILY rates — NOT Σconsumption / Σfleet.
// fleet(d) is COMPAT-AWARE (CPX-only → CPX fleet, COMFORT-only → COMFORT, both/unknown
// → total), supplied by Feature B's daily fleet series (buildFleetDailySeries). The
// forward demand under an engine is demand(d) = rate × projectedFleet(d).
// ─────────────────────────────────────────────────────────────────────────────

export type NaiveWindow = 30 | 90;

/** Consumption rows → date→qty map (summing duplicate dates). Missing days are simply
 *  absent; naiveRate treats an absent day as 0 consumption (a real zero, counted). */
export function consumptionByDate(points: { date: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) {
    const d = String(p.date).slice(0, 10);
    m.set(d, (m.get(d) ?? 0) + (Number(p.qty) || 0));
  }
  return m;
}

/**
 * Naive per-bike consumption rate over a trailing window ending YESTERDAY (today's
 * consumption is partial, so excluded). rate = mean of daily consumption(d)/fleet(d).
 * Zero-consumption days count (rate 0); fleet ≤ 0 days skipped. Returns 0 if no valid
 * day. Pure.
 */
export function naiveRate(args: {
  consumption: Map<string, number>;
  fleetOn: (date: string) => number;
  today: string;
  windowDays: NaiveWindow;
}): number {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= args.windowDays; i++) {
    const date = addDays(args.today, -i);
    const fleet = args.fleetOn(date);
    if (fleet <= 0) continue;
    sum += (args.consumption.get(date) ?? 0) / fleet;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * A day→fleet accessor backed by a daily series indexed from `from` (clamped at both
 * ends). The series is the compat-aware fleet over [from, to] from buildFleetDailySeries.
 */
export function fleetAccessor(series: number[], from: string): (date: string) => number {
  return (date: string) => {
    if (series.length === 0) return 0;
    const idx = diffDays(from, String(date).slice(0, 10));
    if (idx <= 0) return series[0];
    if (idx >= series.length) return series[series.length - 1];
    return series[idx];
  };
}

/** One fleet segment's control points + growth rate, keyed by its display name. */
export interface FleetSegmentInput {
  segment: string;
  controlPoints: FleetControlPoint[];
  monthlyGrowthRate: number;
}

/**
 * Build the {cpx, comfort, total} DAILY fleet series over [from, to] from the fleet
 * segments (each via buildFleetDailySeries). A segment is classed by name containing
 * 'cpx'/'comfort' (case-insensitive). total = cpx+comfort when both per-model segments
 * exist; else an explicit 'total'-named segment; else the elementwise sum of ALL
 * segments. cpx/comfort fall back to total when their segment is absent (so a CPX-only
 * SKU still gets a sensible divisor). Pure.
 */
export function buildCompatFleetSeries(args: {
  segments: FleetSegmentInput[];
  from: string;
  to: string;
}): { cpx: number[]; comfort: number[]; total: number[] } {
  const n = Math.max(0, diffDays(args.from, args.to)) + 1;
  const zero = () => new Array<number>(n).fill(0);
  const sum = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));
  const seriesFor = (s: FleetSegmentInput) =>
    buildFleetDailySeries({ controlPoints: s.controlPoints, monthlyGrowthRate: s.monthlyGrowthRate, from: args.from, to: args.to });

  const cpxSeg = args.segments.find((s) => s.segment.toLowerCase().includes('cpx'));
  const comfortSeg = args.segments.find((s) => s.segment.toLowerCase().includes('comfort'));
  const totalSeg = args.segments.find((s) => s.segment.toLowerCase() === 'total');

  const cpxSeries = cpxSeg ? seriesFor(cpxSeg) : null;
  const comfortSeries = comfortSeg ? seriesFor(comfortSeg) : null;

  let total: number[];
  if (cpxSeries && comfortSeries) total = sum(cpxSeries, comfortSeries);
  else if (totalSeg) total = seriesFor(totalSeg);
  else if (args.segments.length > 0) total = args.segments.map(seriesFor).reduce(sum, zero());
  else total = zero();

  return { cpx: cpxSeries ?? total, comfort: comfortSeries ?? total, total };
}

/**
 * Compat-aware fleet series for a SKU: CPX-only → cpx, COMFORT-only → comfort,
 * both/unknown → total. `models` is compatModels.get(skuBase).
 */
export function pickCompatFleet(
  models: Set<string> | undefined,
  series: { cpx: number[]; comfort: number[]; total: number[] },
): number[] {
  const hasCpx = models?.has('cpx') ?? false;
  const hasComfort = models?.has('comfort') ?? false;
  if (hasCpx && !hasComfort) return series.cpx;
  if (hasComfort && !hasCpx) return series.comfort;
  return series.total;
}

/**
 * Synthetic forecast for an engine: demand(day) = rate × projectedFleet(day), a flat
 * per-bike rate scaled by the projected (compat-aware) fleet. No `source` (synthetic →
 * no provenance badge). horizonDays is set to the full horizon so the projection never
 * applies weekday-extrapolation styling to this comparison line.
 */
export function buildNaiveForecast(args: {
  skuBase: string;
  window: NaiveWindow;
  rate: number;
  fleetOn: (date: string) => number;
  today: string;
  horizonDays: number;
}): SkuForecast {
  const points = [];
  for (let day = 1; day <= args.horizonDays; day++) {
    const date = addDays(args.today, day);
    const yhat = Math.max(0, args.rate * args.fleetOn(date));
    points.push({ day, date, yhat, lo: yhat, hi: yhat });
  }
  return {
    skuBase: args.skuBase,
    asOfDate: args.today,
    abcClass: 'C',
    modelVersion: `naive-L${args.window}`,
    horizonDays: args.horizonDays,
    points,
  };
}
