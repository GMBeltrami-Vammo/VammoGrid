import { describe, expect, it } from 'vitest';
import { forwardAvgDemand } from './projection';

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
