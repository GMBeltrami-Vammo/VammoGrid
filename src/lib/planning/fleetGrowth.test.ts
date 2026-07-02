import { describe, expect, it } from 'vitest';
import { projectFleetGrowth } from './fleetGrowth';

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
