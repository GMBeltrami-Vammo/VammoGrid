import type { SkuForecast } from '@/types/planning';

// Turns a SkuForecast (sparse, model-horizon-bounded) into dense daily arrays out to an
// arbitrary number of days. Past the model horizon it REPEATS THE LAST PREDICTED WEEK by
// weekday (the last 7 in-horizon days, cycled) so the weekday pattern (e.g. low Sundays) is
// preserved rather than flattened — this lets us project to 150 days even though the model
// only emits ~90, and feeds the runway-DOH integral. (Sparse gaps INSIDE the horizon still
// fall back to the last-`tailWindow` mean.)

export interface DailyDemand {
  /** yhat[d] = forecast demand on day d (index 0 = today, unused, = 0). */
  yhat: number[];
  lo: number[];
  hi: number[];
  /** Model horizon in days; any day > horizon is extrapolated. */
  horizon: number;
  /** Highest day index populated. */
  length: number;
}

export function buildDailyDemand(
  fc: SkuForecast | null,
  days: number,
  tailWindow = 14,
): DailyDemand {
  const yhat = new Array<number>(days + 1).fill(0);
  const lo = new Array<number>(days + 1).fill(0);
  const hi = new Array<number>(days + 1).fill(0);
  const horizon = fc?.horizonDays ?? 0;

  if (fc && fc.points.length > 0) {
    const byDay = new Map<number, { yhat: number; lo: number; hi: number }>();
    for (const p of fc.points) byDay.set(p.day, { yhat: p.yhat, lo: p.lo, hi: p.hi });

    const sorted = [...fc.points].sort((a, b) => a.day - b.day);
    const tail = sorted.slice(Math.max(0, sorted.length - tailWindow));
    const n = Math.max(1, tail.length);
    const tailY = tail.reduce((s, p) => s + p.yhat, 0) / n;
    const tailLo = tail.reduce((s, p) => s + p.lo, 0) / n;
    const tailHi = tail.reduce((s, p) => s + p.hi, 0) / n;

    for (let d = 1; d <= days; d++) {
      const p = byDay.get(d);
      if (p) {
        yhat[d] = p.yhat;
        lo[d] = p.lo;
        hi[d] = p.hi;
      } else if (d <= horizon) {
        // Sparse gap inside the model horizon → tail-mean fallback.
        yhat[d] = tailY;
        lo[d] = tailLo;
        hi[d] = tailHi;
      } else {
        // Past the model horizon → repeat the last predicted week by weekday (cycle the
        // last 7 in-horizon days), preserving the weekday pattern instead of flattening it.
        const src = Math.max(1, horizon - 6 + ((d - horizon - 1) % 7));
        yhat[d] = yhat[src];
        lo[d] = lo[src];
        hi[d] = hi[src];
      }
    }
  }

  return { yhat, lo, hi, horizon, length: days };
}

/** Mean daily demand over the first `n` forecast days (for cover / risk estimates). */
export function meanDailyDemand(fc: SkuForecast | null, n = 30): number {
  if (!fc || fc.points.length === 0) return 0;
  const slice = fc.points.slice(0, n);
  return slice.reduce((s, p) => s + p.yhat, 0) / slice.length;
}

/** Cumulative sum; out[i] = Σ arr[0..i]. */
export function cumsum(arr: number[]): number[] {
  const out = new Array<number>(arr.length).fill(0);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    out[i] = s;
  }
  return out;
}
