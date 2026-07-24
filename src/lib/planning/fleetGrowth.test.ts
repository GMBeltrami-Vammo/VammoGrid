import { describe, expect, it } from 'vitest';
import {
  buildFleetDailySeries,
  fleetSizeOn,
  netMonthlyGrowthRate,
  projectFleetGrowth,
  type FleetControlPoint,
} from './fleetGrowth';

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

// Control-point model (Feature B / decisions.MD #34): constant before first, linear
// interpolation between points, linear growth after last. This is the divisor source
// for the L30/L90 comparison engines, so a wrong rule quietly skews every naive rate.
describe('fleetSizeOn — control-point interpolation', () => {
  const points: FleetControlPoint[] = [
    { date: '2026-06-01', size: 1000 },
    { date: '2026-07-01', size: 1300 }, // +300 over 30 days
  ];

  it('holds CONSTANT at the first point before the first date (no retro-projection)', () => {
    expect(fleetSizeOn(points, 0.1, '2026-05-01')).toBe(1000);
    expect(fleetSizeOn(points, 0.1, '2026-06-01')).toBe(1000); // exactly at first
  });

  it('returns the exact size AT a control-point date', () => {
    expect(fleetSizeOn(points, 0.1, '2026-07-01')).toBe(1300);
  });

  it('linearly interpolates between two consecutive points', () => {
    // 2026-06-16 is 15/30 of the way from 1000→1300 → 1150
    expect(fleetSizeOn(points, 0.1, '2026-06-16')).toBe(1150);
  });

  it('grows linearly off the LAST point after it', () => {
    // +10%/month off 1300, ~1 month later ≈ 1300 × (1 + 0.1 × 30.44/30.44) = 1430
    expect(fleetSizeOn(points, 0.1, '2026-07-31')).toBeGreaterThan(1420);
    expect(fleetSizeOn(points, 0.1, '2026-07-31')).toBeLessThan(1440);
  });

  it('accepts unsorted control points', () => {
    const unsorted: FleetControlPoint[] = [points[1], points[0]];
    expect(fleetSizeOn(unsorted, 0.1, '2026-06-16')).toBe(1150);
  });

  it('returns 0 with no control points', () => {
    expect(fleetSizeOn([], 0.1, '2026-07-01')).toBe(0);
  });

  it('a single control point → constant before, growth after', () => {
    const one: FleetControlPoint[] = [{ date: '2026-07-01', size: 500 }];
    expect(fleetSizeOn(one, 0.1, '2026-06-01')).toBe(500); // constant before
    expect(fleetSizeOn(one, 0, '2026-09-01')).toBe(500); // flat when rate 0
  });
});

describe('buildFleetDailySeries', () => {
  const points: FleetControlPoint[] = [
    { date: '2026-06-01', size: 1000 },
    { date: '2026-07-01', size: 1300 },
  ];

  it('produces one entry per day inclusive, indexed from `from`', () => {
    const s = buildFleetDailySeries({ controlPoints: points, monthlyGrowthRate: 0.1, from: '2026-06-01', to: '2026-06-11' });
    expect(s).toHaveLength(11);
    expect(s[0]).toBe(1000); // at first point
    expect(s[10]).toBe(fleetSizeOn(points, 0.1, '2026-06-11')); // day 10 = 2026-06-11
  });

  it('daily series matches fleetSizeOn day-by-day', () => {
    const from = '2026-05-20';
    const to = '2026-07-20';
    const s = buildFleetDailySeries({ controlPoints: points, monthlyGrowthRate: 0.08, from, to });
    expect(s[0]).toBe(1000); // constant before first
    // spot-check a future day past the last point
    const idx = s.length - 1;
    expect(s[idx]).toBe(fleetSizeOn(points, 0.08, to));
    expect(s[idx]).toBeGreaterThan(1300); // grown past the last point
  });
});
