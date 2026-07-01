import { addDays } from './dates';

// Fleet-size growth projection (sub-project E). Pure/deterministic: given the current
// fleet size and a steady monthly growth rate, project the weekly fleet-size curve by
// compounding. Reads its inputs from dev.fleet_info (segment 'total'); this module only
// does the math. NOT wired into the ML demand forecast — visibility only (see spec).

/** Average weeks per month (365.25 / 12 / 7). Converts the monthly rate to a weekly one. */
const WEEKS_PER_MONTH = 4.348;

export interface FleetGrowthPoint {
  week: number;
  /** YYYY-MM-DD at the end of this week (from `today`). */
  date: string;
  /** Projected fleet size, compounded. */
  size: number;
}

/**
 * Weekly fleet-size curve for `weeks` weeks from `today`.
 * size(w) = current × (1 + monthlyRate)^(w / weeksPerMonth), rounded.
 * A zero/undefined rate yields a flat line at the current size.
 */
export function projectFleetGrowth(args: {
  currentSize: number;
  monthlyGrowthRate: number;
  today: string;
  weeks?: number;
}): FleetGrowthPoint[] {
  const { currentSize, today } = args;
  const rate = Number.isFinite(args.monthlyGrowthRate) ? args.monthlyGrowthRate : 0;
  const weeks = Math.max(1, Math.round(args.weeks ?? 26));
  const base = Math.max(0, Math.round(currentSize));

  return Array.from({ length: weeks + 1 }, (_, w) => ({
    week: w,
    date: addDays(today, w * 7),
    size: Math.round(base * Math.pow(1 + rate, w / WEEKS_PER_MONTH)),
  }));
}
