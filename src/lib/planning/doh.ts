// ─────────────────────────────────────────────────────────────────────────────
// Days-on-hand as a RUNWAY INTEGRAL (the canonical DOH across the app).
//
// DOH(d) = how many days the stock at day d lasts against the PREDICTED daily
// consumption, INTEGRATED forward, IGNORING all incoming orders:
//
//   DOH(d) = smallest k ≥ 0 such that  Σ demand(d+1 .. d+k)  ≥  stock(d)
//
// Properties (by construction):
//   • Between order arrivals it decrements exactly by 1/day: stock(d)=stock(d−1)−demand(d)
//     and cum(d)=cum(d−1)+demand(d) leave the exhaustion day fixed, so DOH(d)=DOH(d−1)−1.
//   • On an arrival day the higher stock pushes the exhaustion day out → DOH jumps
//     (recompute). Recovery inflow (repairable SKUs) is treated the same as an order:
//     reflected in stock(d) but NOT credited in the forward integral (conservative runway).
//   • Beyond the model horizon the demand array already repeats the last predicted week
//     by weekday (see buildDailyDemand), and a CLOSED-FORM tail (remaining ÷ the repeated
//     week's mean/day) reports the TRUE number even past the projection horizon — no cap,
//     no unbounded loop.
//   • Zero consumption ahead ⇒ never exhausts ⇒ null (matches "no demand → no DOH").
//
// Replaces the old rate divisor (stock ÷ next-7-day-avg). Computed ONCE per projection
// (prefix sums) and stored on each ProjectionPoint; every consumer reads point.doh.
// ─────────────────────────────────────────────────────────────────────────────

export interface DohPoint {
  stock: number;
  demand: number;
}

export interface DohContext {
  /** cum[d] = Σ demand[1..d] (cum[0] = 0; demand[0] is today, = 0). */
  cum: Float64Array;
  /** Last timeline index. */
  H: number;
  /** Mean daily demand of the last 7 timeline days — the repeated-week tail rate. */
  weekMean: number;
}

/** Prefix sums of daily demand + the repeated-week mean/day, built once per timeline. */
export function buildDohContext(timeline: DohPoint[]): DohContext {
  const H = timeline.length - 1;
  const cum = new Float64Array(Math.max(1, H + 1));
  for (let d = 1; d <= H; d++) cum[d] = cum[d - 1] + (timeline[d]?.demand ?? 0);
  let sum = 0;
  let n = 0;
  for (let d = Math.max(1, H - 6); d <= H; d++) {
    sum += timeline[d]?.demand ?? 0;
    n++;
  }
  return { cum, H, weekMean: n > 0 ? sum / n : 0 };
}

/**
 * Runway (in days) from `stock` held at day `fromDay`, integrating future consumption and
 * ignoring inbound. Returns an integer day count, or null when nothing is consumed ahead
 * (never exhausts). Ruptured stock (≤ 0) → 0.
 */
export function runwayFrom(ctx: DohContext, fromDay: number, stock: number): number | null {
  const { cum, H, weekMean } = ctx;
  if (H <= 0) return weekMean > 0 && stock > 0 ? Math.ceil(stock / weekMean) : stock > 0 ? null : 0;
  if (stock <= 0) return 0;
  const from = Math.max(0, Math.min(fromDay, H));
  const target = cum[from] + stock; // cumulative consumption needed to exhaust the stock
  if (cum[H] >= target) {
    // Exhausts within the horizon → first day E > from with cum[E] ≥ target (lower bound).
    let lo = from + 1;
    let hi = H;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] >= target) hi = mid;
      else lo = mid + 1;
    }
    return lo - from;
  }
  // Exhausts beyond the horizon → closed-form tail at the repeated-week mean/day.
  if (weekMean <= 0) return null; // no consumption ahead → never runs out
  const remaining = target - cum[H];
  return H - from + Math.ceil(remaining / weekMean);
}

/** Runway DOH for every day of the timeline (reads stock + demand; ignores inbound). */
export function computeRunwayDoh(timeline: DohPoint[]): (number | null)[] {
  const ctx = buildDohContext(timeline);
  return timeline.map((p, d) => runwayFrom(ctx, d, p?.stock ?? 0));
}

/**
 * Stock needed to cover the next `days` days of consumption starting at `fromDay` — the
 * inverse of the runway, used by the cascade to size "hold piso DOH" orders (target stock =
 * consumptionOver(arrival, piso)). Uses the horizon prefix sums + the repeated-week tail.
 */
export function consumptionOver(ctx: DohContext, fromDay: number, days: number): number {
  const { cum, H, weekMean } = ctx;
  if (days <= 0) return 0;
  const from = Math.max(0, Math.min(fromDay, H));
  const end = from + days;
  if (end <= H) return cum[end] - cum[from];
  return cum[H] - cum[from] + weekMean * (end - H); // tail at the repeated-week rate
}
