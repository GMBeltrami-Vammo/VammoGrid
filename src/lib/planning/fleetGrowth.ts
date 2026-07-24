import { addDays, diffDays } from './dates';

// Fleet-size growth projection (sub-project E / request #4). Pure/deterministic.
// LINEAR growth per the user's formula — each step adds rate × baseFleet × dt:
//   size(t) = base × (1 + monthlyRate × months(t))
// so the increment over dt is monthlyRate × base × dt (constant absolute rate off the
// base fleet), NOT compounding. Reads inputs from dev.fleet_info; math only. NOT wired
// into the ML demand forecast — visibility only.
//
// Feature B (decisions.MD #34) adds an editable CONTROL-POINTS model on top: the past
// is piecewise-linear interpolation between (date, size) control points, held CONSTANT
// before the first point (no retro-projection), and the future is linear growth off the
// LAST point. fleetSizeOn / buildFleetDailySeries expose a daily series for any range —
// the compat-aware divisor the L30/L90 comparison engines (Feature C) consume.

/** Average weeks per month (365.25 / 12 / 7). Converts weeks ↔ months. */
const WEEKS_PER_MONTH = 4.348;
/** Average days per month, consistent with WEEKS_PER_MONTH (4.348 × 7 ≈ 30.44). */
const DAYS_PER_MONTH = WEEKS_PER_MONTH * 7;

/** Linear fleet size: base × (1 + rate × months), floored at 0 and rounded. The single
 *  canonical growth formula — shared by projectFleetGrowth and the control-point series. */
function linearSize(base: number, monthlyGrowthRate: number, months: number): number {
  const rate = Number.isFinite(monthlyGrowthRate) ? monthlyGrowthRate : 0;
  return Math.max(0, Math.round(base * (1 + rate * months)));
}

/** A fleet-size control point: a real (or fallback) observation of the segment's size. */
export interface FleetControlPoint {
  /** YYYY-MM-DD. */
  date: string;
  size: number;
}

/**
 * Fleet size on a single date from control points + growth rate (decisions.MD #34):
 *  - CONSTANT at the first point's size before the first point (no retro-projection);
 *  - linear interpolation between consecutive points;
 *  - linear growth off the LAST point after it.
 * Returns 0 when there are no control points.
 */
export function fleetSizeOn(
  points: FleetControlPoint[],
  monthlyGrowthRate: number,
  date: string,
): number {
  if (points.length === 0) return 0;
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (date <= first.date) return Math.max(0, Math.round(first.size)); // constant before first
  if (date >= last.date) {
    return linearSize(last.size, monthlyGrowthRate, diffDays(last.date, date) / DAYS_PER_MONTH);
  }
  // Interpolate within the bracketing pair.
  let lo = first;
  let hi = last;
  for (let i = 0; i < pts.length - 1; i++) {
    if (date >= pts[i].date && date <= pts[i + 1].date) {
      lo = pts[i];
      hi = pts[i + 1];
      break;
    }
  }
  const span = diffDays(lo.date, hi.date);
  if (span <= 0) return Math.max(0, Math.round(lo.size));
  const frac = diffDays(lo.date, date) / span;
  return Math.max(0, Math.round(lo.size + (hi.size - lo.size) * frac));
}

/**
 * Daily fleet-size series over [from, to] inclusive (index 0 = `from`) for ONE segment,
 * applying the control-point rules above. This is the divisor source for Feature C's
 * L30/L90 comparison engines (fleet on each historical + future day). Pure.
 */
export function buildFleetDailySeries(args: {
  controlPoints: FleetControlPoint[];
  monthlyGrowthRate: number;
  from: string;
  to: string;
}): number[] {
  const n = Math.max(0, diffDays(args.from, args.to));
  const out = new Array<number>(n + 1);
  for (let d = 0; d <= n; d++) {
    out[d] = fleetSizeOn(args.controlPoints, args.monthlyGrowthRate, addDays(args.from, d));
  }
  return out;
}

export interface FleetGrowthPoint {
  /** Week offset from the anchor (can be negative for realized/past weeks). */
  week: number;
  /** YYYY-MM-DD at this week. */
  date: string;
  /** Projected fleet size (linear). */
  size: number;
}

/**
 * Weekly fleet-size curve, linear: size(w) = base × (1 + rate × w/weeksPerMonth).
 * Anchored at `anchor` (the as-of date, size = base). `pastWeeks` extends the curve
 * backward (realized) and `futureWeeks` forward (estimated); the boundary "today" is
 * whichever week lands on `today`. A zero rate yields a flat line.
 */
/**
 * Effective monthly growth rate for a segment (review item 2 fase 2). When commercial
 * target and/or churn are informed (both as a fraction of fleet per month), the net
 * rate = meta − churn overrides the manual `monthlyGrowthRate`; otherwise the manual
 * rate is used. A missing side counts as 0 only when the other side is present.
 * Pure — unit tested.
 */
export function netMonthlyGrowthRate(args: {
  monthlyGrowthRate: number;
  commercialTargetPct: number | null;
  churnPct: number | null;
}): number {
  const { commercialTargetPct: meta, churnPct: churn } = args;
  if (meta == null && churn == null) {
    return Number.isFinite(args.monthlyGrowthRate) ? args.monthlyGrowthRate : 0;
  }
  return (meta ?? 0) - (churn ?? 0);
}

export function projectFleetGrowth(args: {
  base: number;
  monthlyGrowthRate: number;
  anchor: string;
  pastWeeks?: number;
  futureWeeks?: number;
}): FleetGrowthPoint[] {
  const base = Math.max(0, Math.round(args.base));
  const past = Math.max(0, Math.round(args.pastWeeks ?? 0));
  const future = Math.max(1, Math.round(args.futureWeeks ?? 26));

  const points: FleetGrowthPoint[] = [];
  for (let w = -past; w <= future; w++) {
    const size = linearSize(base, args.monthlyGrowthRate, w / WEEKS_PER_MONTH);
    points.push({ week: w, date: addDays(args.anchor, w * 7), size });
  }
  return points;
}
