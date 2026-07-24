import { describe, expect, it } from 'vitest';
import {
  buildCompatFleetSeries,
  buildNaiveForecast,
  consumptionByDate,
  fleetAccessor,
  mapFleetSegments,
  naiveRate,
  pickCompatFleet,
} from './naiveEngines';

const TODAY = '2026-07-10';

describe('naiveRate — mean of daily per-bike rates', () => {
  it('worked example: 300/50=6, 500/100=5 → 5.5 (mean of daily rates, NOT total/total)', () => {
    // Σqty/Σfleet would be 800/150 = 5.333 — the rule is the mean of daily rates = 5.5.
    const consumption = new Map<string, number>([
      ['2026-07-08', 300],
      ['2026-07-09', 500],
    ]);
    const fleetOn = (d: string) => (d === '2026-07-08' ? 50 : d === '2026-07-09' ? 100 : 0);
    expect(naiveRate({ consumption, fleetOn, today: TODAY, windowDays: 30 })).toBeCloseTo(5.5, 10);
  });

  it('zero-consumption days count as rate 0 (averaged over all days in the window)', () => {
    // Isolate 3 valid days (fleet 0 elsewhere → skipped): 07-09 → 600/100=6, 07-08 →
    // absent=0 (the zero day, COUNTED), 07-07 → 500/100=5; mean = (6+0+5)/3 = 11/3.
    const valid = new Set(['2026-07-07', '2026-07-08', '2026-07-09']);
    const consumption = new Map<string, number>([
      ['2026-07-09', 600],
      ['2026-07-07', 500],
    ]);
    const fleetOn = (d: string) => (valid.has(d) ? 100 : 0);
    expect(naiveRate({ consumption, fleetOn, today: TODAY, windowDays: 90 })).toBeCloseTo(11 / 3, 10);
  });

  it('skips days with fleet ≤ 0 (excluded from the mean AND the count)', () => {
    // 07-09 has fleet 0 (skipped); only 07-08 counts → 500/100 = 5. All other days fleet 0.
    const consumption = new Map<string, number>([['2026-07-08', 500], ['2026-07-09', 700]]);
    const fleetOn = (d: string) => (d === '2026-07-08' ? 100 : 0);
    expect(naiveRate({ consumption, fleetOn, today: TODAY, windowDays: 30 })).toBeCloseTo(5, 10);
  });

  it('excludes today (partial day) — window starts yesterday', () => {
    // Only 07-09 has fleet > 0; today (07-10) is never iterated, so its 999 is ignored.
    const consumption = new Map<string, number>([[TODAY, 999], ['2026-07-09', 100]]);
    const fleetOn = (d: string) => (d === '2026-07-09' ? 100 : 0);
    expect(naiveRate({ consumption, fleetOn, today: TODAY, windowDays: 30 })).toBeCloseTo(1, 10);
  });

  it('returns 0 when no valid day (all fleet ≤ 0)', () => {
    expect(naiveRate({ consumption: new Map(), fleetOn: () => 0, today: TODAY, windowDays: 30 })).toBe(0);
  });
});

describe('consumptionByDate', () => {
  it('sums duplicate dates and slices to YYYY-MM-DD', () => {
    const m = consumptionByDate([
      { date: '2026-07-08T00:00:00Z', qty: 10 },
      { date: '2026-07-08', qty: 5 },
      { date: '2026-07-09', qty: 7 },
    ]);
    expect(m.get('2026-07-08')).toBe(15);
    expect(m.get('2026-07-09')).toBe(7);
  });
});

describe('fleetAccessor', () => {
  const series = [100, 110, 120, 130]; // from 2026-07-01
  const fleetOn = fleetAccessor(series, '2026-07-01');
  it('indexes by day offset from `from`', () => {
    expect(fleetOn('2026-07-01')).toBe(100);
    expect(fleetOn('2026-07-03')).toBe(120);
  });
  it('clamps before/after the series', () => {
    expect(fleetOn('2026-06-01')).toBe(100); // before → first
    expect(fleetOn('2026-08-01')).toBe(130); // after → last
  });
  it('returns 0 for an empty series', () => {
    expect(fleetAccessor([], '2026-07-01')('2026-07-01')).toBe(0);
  });
});

describe('pickCompatFleet', () => {
  const series = { cpx: [10], comfort: [20], total: [30] };
  it('CPX-only → cpx', () => {
    expect(pickCompatFleet(new Set(['cpx']), series)).toBe(series.cpx);
  });
  it('COMFORT-only → comfort', () => {
    expect(pickCompatFleet(new Set(['comfort']), series)).toBe(series.comfort);
  });
  it('both → total', () => {
    expect(pickCompatFleet(new Set(['cpx', 'comfort']), series)).toBe(series.total);
  });
  it('unknown/empty → total', () => {
    expect(pickCompatFleet(undefined, series)).toBe(series.total);
    expect(pickCompatFleet(new Set(), series)).toBe(series.total);
  });
});

describe('buildCompatFleetSeries', () => {
  const P = (size: number) => [{ date: '2026-07-01', size }]; // flat single point
  const range = { from: '2026-07-01', to: '2026-07-03' }; // 3 days

  it('per-model segments: cpx/comfort split, total = sum', () => {
    const r = buildCompatFleetSeries({
      segments: [
        { segment: 'CPX', controlPoints: P(100), monthlyGrowthRate: 0 },
        { segment: 'COMFORT', controlPoints: P(200), monthlyGrowthRate: 0 },
      ],
      ...range,
    });
    expect(r.cpx).toEqual([100, 100, 100]);
    expect(r.comfort).toEqual([200, 200, 200]);
    expect(r.total).toEqual([300, 300, 300]);
  });

  it('only a total segment → cpx = comfort = total (no split available)', () => {
    const r = buildCompatFleetSeries({
      segments: [{ segment: 'total', controlPoints: P(500), monthlyGrowthRate: 0 }],
      ...range,
    });
    expect(r.total).toEqual([500, 500, 500]);
    expect(r.cpx).toEqual([500, 500, 500]);
    expect(r.comfort).toEqual([500, 500, 500]);
  });

  it('cpx-only present → comfort falls back to total (=cpx here)', () => {
    const r = buildCompatFleetSeries({
      segments: [{ segment: 'CPX', controlPoints: P(100), monthlyGrowthRate: 0 }],
      ...range,
    });
    expect(r.cpx).toEqual([100, 100, 100]);
    expect(r.total).toEqual([100, 100, 100]); // sum of all segments = just cpx
    expect(r.comfort).toEqual([100, 100, 100]); // fallback to total
  });

  it('no segments → all zeros', () => {
    const r = buildCompatFleetSeries({ segments: [], ...range });
    expect(r.total).toEqual([0, 0, 0]);
    expect(r.cpx).toEqual([0, 0, 0]);
  });
});

describe('mapFleetSegments', () => {
  it('builds control points from weekly rows + net growth rate', () => {
    const segs = mapFleetSegments(
      [{ segment: 'CPX', current_size: 1000, monthly_growth_rate: 0.05, commercial_target_pct: null, churn_pct: null, as_of_date: '2026-07-01' }],
      [
        { segment: 'CPX', week_start: '2026-06-01', size: 900 },
        { segment: 'CPX', week_start: '2026-07-01', size: 1000 },
        { segment: 'COMFORT', week_start: '2026-07-01', size: 5 }, // other segment ignored
      ],
      '2026-07-10',
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].controlPoints).toEqual([
      { date: '2026-06-01', size: 900 },
      { date: '2026-07-01', size: 1000 },
    ]);
    expect(segs[0].monthlyGrowthRate).toBeCloseTo(0.05, 10);
  });

  it('falls back to a single point (as_of/current_size) when no weekly rows', () => {
    const noAsOf = mapFleetSegments(
      [{ segment: 'C', current_size: 500, monthly_growth_rate: 0.1, commercial_target_pct: null, churn_pct: null, as_of_date: null }],
      [],
      '2026-07-10',
    );
    expect(noAsOf[0].controlPoints).toEqual([{ date: '2026-07-10', size: 500 }]); // fallbackDate

    const withAsOf = mapFleetSegments(
      [{ segment: 'C', current_size: 500, monthly_growth_rate: 0, commercial_target_pct: null, churn_pct: null, as_of_date: '2026-06-15' }],
      [],
      '2026-07-10',
    );
    expect(withAsOf[0].controlPoints).toEqual([{ date: '2026-06-15', size: 500 }]);
  });

  it('applies meta − churn precedence over the manual rate', () => {
    const segs = mapFleetSegments(
      [{ segment: 'CPX', current_size: 1000, monthly_growth_rate: 0.05, commercial_target_pct: 0.08, churn_pct: 0.03, as_of_date: null }],
      [],
      '2026-07-10',
    );
    expect(segs[0].monthlyGrowthRate).toBeCloseTo(0.05, 10); // 0.08 − 0.03, not the manual 0.05 coincidence
  });
});

describe('buildNaiveForecast', () => {
  it('demand(day) = rate × projectedFleet(day); flat band (lo=hi=yhat); no provenance source', () => {
    const fc = buildNaiveForecast({
      skuBase: 'X',
      window: 30,
      rate: 0.05,
      fleetOn: () => 1000,
      today: TODAY,
      horizonDays: 150,
    });
    expect(fc.points).toHaveLength(150);
    expect(fc.horizonDays).toBe(150);
    expect(fc.source).toBeUndefined(); // synthetic → no badge
    expect(fc.modelVersion).toBe('naive-L30');
    const p = fc.points[0];
    expect(p.day).toBe(1);
    expect(p.yhat).toBeCloseTo(50, 10); // 0.05 × 1000
    expect(p.lo).toBe(p.yhat);
    expect(p.hi).toBe(p.yhat);
  });

  it('scales demand with a growing fleet', () => {
    const fleetOn = fleetAccessor([1000, 2000], TODAY); // fleet doubles by day 1
    const fc = buildNaiveForecast({ skuBase: 'X', window: 90, rate: 0.1, fleetOn: fleetOn, today: TODAY, horizonDays: 2 });
    expect(fc.points[0].yhat).toBeCloseTo(200, 10); // day1 fleet 2000 × 0.1
  });
});
