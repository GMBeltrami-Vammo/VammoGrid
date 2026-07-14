import { describe, expect, it } from 'vitest';
import { netMonthlyGrowthRate, projectFleetGrowth } from './fleetGrowth';

const ANCHOR = '2026-07-01';

describe('projectFleetGrowth (linear)', () => {
  it('anchors at the base size (week 0)', () => {
    const curve = projectFleetGrowth({ base: 1000, monthlyGrowthRate: 0.1, anchor: ANCHOR, futureWeeks: 8 });
    const w0 = curve.find((p) => p.week === 0)!;
    expect(w0).toMatchObject({ date: ANCHOR, size: 1000 });
  });

  it('grows linearly — ~+10% after ~1 month, ~+20% after ~2', () => {
    const curve = projectFleetGrowth({ base: 1000, monthlyGrowthRate: 0.1, anchor: ANCHOR, futureWeeks: 16 });
    const at = (w: number) => curve.find((p) => p.week === w)!.size;
    expect(at(4)).toBeGreaterThan(1080); // ~1 month ≈ 4.35 weeks
    expect(at(4)).toBeLessThan(1100);
    // linear: equal week-spans add equal amounts (no compounding)
    expect(at(8) - at(4)).toBeCloseTo(at(4) - at(0), -1);
  });

  it('extends backward for the realized/past portion', () => {
    const curve = projectFleetGrowth({ base: 1000, monthlyGrowthRate: 0.1, anchor: ANCHOR, pastWeeks: 8, futureWeeks: 8 });
    expect(curve[0].week).toBe(-8);
    expect(curve[0].size).toBeLessThan(1000); // past is smaller with positive growth
  });

  it('is flat when the rate is zero', () => {
    const curve = projectFleetGrowth({ base: 7083, monthlyGrowthRate: 0, anchor: ANCHOR, futureWeeks: 6 });
    expect(curve.every((p) => p.size === 7083)).toBe(true);
  });
});

// Net growth = meta − churn when either is informed (review item 2 fase 2); else the
// manual rate. A lossy rule here would silently mis-project the whole fleet curve.
describe('netMonthlyGrowthRate', () => {
  it('uses the manual rate when neither meta nor churn is set', () => {
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: null, churnPct: null })).toBe(0.05);
  });

  it('meta − churn overrides the manual rate when both present', () => {
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: 0.08, churnPct: 0.03 })).toBeCloseTo(0.05, 10);
  });

  it('a missing side counts as 0 only when the other is present', () => {
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: null, churnPct: 0.02 })).toBeCloseTo(-0.02, 10);
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: 0.04, churnPct: null })).toBeCloseTo(0.04, 10);
  });

  it('meta − churn can be zero (flat) even with a nonzero manual rate', () => {
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: 0.03, churnPct: 0.03 })).toBe(0);
  });

  it('non-finite manual rate falls back to 0', () => {
    expect(netMonthlyGrowthRate({ monthlyGrowthRate: NaN, commercialTargetPct: null, churnPct: null })).toBe(0);
  });

  it('net 0 (meta=churn) yields a flat projected curve', () => {
    const rate = netMonthlyGrowthRate({ monthlyGrowthRate: 0.05, commercialTargetPct: 0.03, churnPct: 0.03 });
    const pts = projectFleetGrowth({ base: 1000, monthlyGrowthRate: rate, anchor: ANCHOR, pastWeeks: 0, futureWeeks: 8 });
    expect(pts.every((p) => p.size === 1000)).toBe(true);
  });
});
