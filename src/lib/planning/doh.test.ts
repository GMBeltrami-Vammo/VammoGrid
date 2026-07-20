import { describe, expect, it } from 'vitest';
import { forwardAvgDemand } from './projection';
import { buildDohContext, computeRunwayDoh, consumptionOver, runwayFrom } from './doh';

// DOH = stock ÷ the NEXT 7 days' average daily consumption (not a single day's demand).
// The single-day denominator was erratic: a spiky or zero day at a week boundary made
// the displayed coverage jump or vanish. These tests pin the canonical rate + document
// the "59 DOH" artifact the heatmap showed.

const flat = (v: number, n = 30) => Array.from({ length: n }, () => ({ demand: v }));

describe('forwardAvgDemand', () => {
  it('averages the next `window` days (default 7), ignoring the current + past days', () => {
    const tl = flat(0).map((_, i) => ({ demand: i })); // demand[i] = i
    // days 4..10 → (4+5+6+7+8+9+10)/7 = 7
    expect(forwardAvgDemand(tl, 3, 7)).toBe(7);
  });

  it('honours a custom window', () => {
    const tl = [{ demand: 0 }, { demand: 2 }, { demand: 4 }, { demand: 6 }];
    // from day 0, next 2 → (2+4)/2 = 3
    expect(forwardAvgDemand(tl, 0, 2)).toBe(3);
  });

  it('falls back to the point’s own demand at the end of the horizon', () => {
    const tl = [{ demand: 5 }, { demand: 9 }];
    expect(forwardAvgDemand(tl, 1, 7)).toBe(9); // no forward days → own demand
  });

  it('returns 0 when there is no demand at all ahead or at the point', () => {
    expect(forwardAvgDemand([{ demand: 0 }], 0, 7)).toBe(0);
  });
});

describe('regression: a single-day demand spike no longer distorts DOH', () => {
  it('stable next-week rate instead of a misleading 59', () => {
    // 600 units on hand; steady ~5/day going forward, but the week-boundary day spikes.
    const tl = flat(5, 20);
    tl[7] = { demand: 10.2 }; // the single boundary day
    const stock = 600;

    // Old behaviour (÷ that single day): 600 / 10.2 ≈ 59 → looked below the 60 floor.
    const singleDay = Math.round(stock / tl[7].demand);
    expect(singleDay).toBe(59);

    // New behaviour (÷ next 7 days' average = 5): 600 / 5 = 120 → the true coverage.
    const rate = forwardAvgDemand(tl, 7, 7);
    expect(rate).toBe(5);
    expect(Math.round(stock / rate)).toBe(120);
  });
});

// The RUNWAY DOH (integral) that replaces the rate divisor.
// Build a timeline from a per-day consumption sequence (index 0 = today, demand 0), walking
// stock down (floored at 0, no inbound) — the shape projectStream produces.
function timelineFrom(startStock: number, dailyDemand: number[]): { stock: number; demand: number }[] {
  const tl = [{ stock: startStock, demand: 0 }];
  let stock = startStock;
  for (const dmd of dailyDemand) {
    stock = Math.max(0, stock - dmd);
    tl.push({ stock, demand: dmd });
  }
  return tl;
}

// The user's worked example: 150 units; wk1 5/day (Mon–Sat) + Sun 2; wk2 6/day + Sun 2;
// then repeat wk2. Cumulative crosses 150 at day 29 (146 at 28, 152 at 29).
const WK1 = [5, 5, 5, 5, 5, 5, 2];
const WK2 = [6, 6, 6, 6, 6, 6, 2];
const PATTERN = [...WK1, ...WK2, ...WK2, ...WK2, ...WK2, ...WK2];

describe('runway DOH (integral)', () => {
  it("matches the user's worked example (~29 days for 150 units)", () => {
    const doh = computeRunwayDoh(timelineFrom(150, PATTERN));
    expect(doh[0]).toBe(29);
  });

  it('decrements exactly 1/day when no order arrives', () => {
    const doh = computeRunwayDoh(timelineFrom(150, PATTERN));
    for (let d = 1; d <= 20; d++) expect(doh[d]).toBe((doh[0] as number) - d);
  });

  it('flat 1/day demand → DOH = stock', () => {
    expect(runwayFrom(buildDohContext(timelineFrom(100, Array(200).fill(1))), 0, 100)).toBe(100);
  });

  it('closed-form tail reports the TRUE number past the horizon (no cap)', () => {
    // 60-day timeline at 2/day. 100 units → 50d (within); 300 units → 60 in-horizon (120u) + 180/2 tail = 150d.
    const ctx = buildDohContext(timelineFrom(0, Array(60).fill(2)));
    expect(runwayFrom(ctx, 0, 100)).toBe(50);
    expect(runwayFrom(ctx, 0, 300)).toBe(150);
  });

  it('ruptured stock → 0; zero consumption ahead → null (never runs out)', () => {
    const ctx = buildDohContext(timelineFrom(0, Array(30).fill(0)));
    expect(runwayFrom(ctx, 0, 0)).toBe(0);
    expect(runwayFrom(ctx, 0, 50)).toBeNull();
  });

  it('consumptionOver = stock to cover N days (cascade sizing inverse)', () => {
    const ctx = buildDohContext(timelineFrom(1000, PATTERN));
    expect(consumptionOver(ctx, 0, 7)).toBe(32); // wk1 = 5*6 + 2
  });
});
