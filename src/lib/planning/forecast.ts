import type { SkuForecast } from '@/types/planning';

// Turns a SkuForecast (sparse, model-horizon-bounded) into dense daily arrays out to
// an arbitrary number of days, extrapolating past the model horizon by the mean of
// the last `tailWindow` forecast days. This is the lab's `opCumArr` tail-mean
// extension — it lets us project to 150 days even though the model only emits 90.

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
      } else {
        yhat[d] = tailY;
        lo[d] = tailLo;
        hi[d] = tailHi;
      }
    }
  }

  return { yhat, lo, hi, horizon, length: days };
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
