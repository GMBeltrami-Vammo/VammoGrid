import { addDays } from './dates';

// Fleet-size growth projection (sub-project E / request #4). Pure/deterministic.
// LINEAR growth per the user's formula — each step adds rate × baseFleet × dt:
//   size(t) = base × (1 + monthlyRate × months(t))
// so the increment over dt is monthlyRate × base × dt (constant absolute rate off the
// base fleet), NOT compounding. Reads inputs from dev.fleet_info; math only. NOT wired
// into the ML demand forecast — visibility only.

/** Average weeks per month (365.25 / 12 / 7). Converts weeks ↔ months. */
const WEEKS_PER_MONTH = 4.348;

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
  const rate = Number.isFinite(args.monthlyGrowthRate) ? args.monthlyGrowthRate : 0;
  const base = Math.max(0, Math.round(args.base));
  const past = Math.max(0, Math.round(args.pastWeeks ?? 0));
  const future = Math.max(1, Math.round(args.futureWeeks ?? 26));

  const points: FleetGrowthPoint[] = [];
  for (let w = -past; w <= future; w++) {
    const size = Math.max(0, Math.round(base * (1 + rate * (w / WEEKS_PER_MONTH))));
    points.push({ week: w, date: addDays(args.anchor, w * 7), size });
  }
  return points;
}
