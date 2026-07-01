import { describe, expect, it } from 'vitest';
import { projectFleetGrowth } from './fleetGrowth';

const TODAY = '2026-07-01';

describe('projectFleetGrowth', () => {
  it('starts at the current size (week 0)', () => {
    const curve = projectFleetGrowth({ currentSize: 1000, monthlyGrowthRate: 0.1, today: TODAY, weeks: 8 });
    expect(curve[0]).toMatchObject({ week: 0, date: TODAY, size: 1000 });
    expect(curve).toHaveLength(9); // 0..8
  });

  it('compounds monthly — ~+10% after ~1 month', () => {
    const curve = projectFleetGrowth({ currentSize: 1000, monthlyGrowthRate: 0.1, today: TODAY, weeks: 12 });
    // week ≈ 4.348 is one month; the nearest whole week (4) should be close to 1090.
    expect(curve[4].size).toBeGreaterThan(1080);
    expect(curve[4].size).toBeLessThan(1100);
    // strictly increasing with a positive rate
    for (let i = 1; i < curve.length; i++) expect(curve[i].size).toBeGreaterThanOrEqual(curve[i - 1].size);
  });

  it('is flat when the rate is zero', () => {
    const curve = projectFleetGrowth({ currentSize: 7083, monthlyGrowthRate: 0, today: TODAY, weeks: 6 });
    expect(curve.every((p) => p.size === 7083)).toBe(true);
  });
});
