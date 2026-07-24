import { describe, expect, it } from 'vitest';
import {
  coalesceForecasts,
  coalesceOne,
  maxAsOf,
  rowsToForecasts,
  rowsToOneForecast,
  type ForecastRow,
} from './forecastMerge';

// Build aliased rows for a SKU: one row per horizon day.
function rows(
  sku: string,
  opts: { asOf: string; abc?: string; model?: string; days?: number; yhat?: number; lo?: number | null; hi?: number | null },
): ForecastRow[] {
  const { asOf, abc = 'C', model = 'm', days = 3, yhat = 2 } = opts;
  return Array.from({ length: days }, (_, i) => ({
    sku_base: sku,
    abc_class: abc,
    model_version: model,
    as_of_date: asOf,
    target_date: `2026-07-${String(14 + i).padStart(2, '0')}`,
    horizon_day: i + 1,
    yhat,
    lo: opts.lo === undefined ? yhat - 1 : opts.lo,
    hi: opts.hi === undefined ? yhat + 1 : opts.hi,
  }));
}

describe('rowsToForecasts', () => {
  it('groups rows by sku_base, tags the provenance source, sorts points by day', () => {
    const unsorted: ForecastRow[] = [
      ...rows('VM-01-AAA0-0001', { asOf: '2026-07-13', days: 1 }),
      { ...rows('VM-01-AAA0-0001', { asOf: '2026-07-13', days: 1 })[0], horizon_day: 3, target_date: '2026-07-16' },
      { ...rows('VM-01-AAA0-0001', { asOf: '2026-07-13', days: 1 })[0], horizon_day: 2, target_date: '2026-07-15' },
    ];
    const m = rowsToForecasts(unsorted, 'consumo-diario');
    const fc = m.get('VM-01-AAA0-0001')!;
    expect(fc.source).toBe('consumo-diario');
    expect(fc.horizonDays).toBe(3);
    expect(fc.points.map((p) => p.day)).toEqual([1, 2, 3]);
  });

  it('normalizes abc_class (unknown → C) and slices dates to YYYY-MM-DD', () => {
    const m = rowsToForecasts(
      [{ ...rows('S', { asOf: '2026-07-13T00:00:00Z' })[0], abc_class: 'Z', target_date: '2026-07-14 00:00:00' }],
      'sop',
    );
    const fc = m.get('S')!;
    expect(fc.abcClass).toBe('C');
    expect(fc.asOfDate).toBe('2026-07-13');
    expect(fc.points[0].date).toBe('2026-07-14');
  });

  it('preserves a valid ABC class', () => {
    const m = rowsToForecasts(rows('S', { asOf: '2026-07-13', abc: 'A' }), 'sop');
    expect(m.get('S')!.abcClass).toBe('A');
  });

  it('collapses a missing/blank band to the point (defensive lo/hi)', () => {
    const m = rowsToForecasts(rows('S', { asOf: '2026-07-13', days: 1, yhat: 5, lo: null, hi: null }), 'consumo-diario');
    const p = m.get('S')!.points[0];
    expect(p.lo).toBe(5);
    expect(p.hi).toBe(5);
  });

  it('coerces string numerics and drops blank sku rows', () => {
    const raw: ForecastRow[] = [
      { sku_base: '', abc_class: 'C', model_version: 'm', as_of_date: '2026-07-13', target_date: '2026-07-14', horizon_day: '1', yhat: '2.5', lo: '1', hi: '4' },
      { sku_base: 'S', abc_class: 'C', model_version: 'm', as_of_date: '2026-07-13', target_date: '2026-07-14', horizon_day: '1', yhat: '2.5', lo: '1', hi: '4' },
    ];
    const m = rowsToForecasts(raw, 'sop');
    expect(m.has('')).toBe(false);
    expect(m.get('S')!.points[0].yhat).toBe(2.5);
  });
});

describe('coalesceForecasts — per-SKU preference', () => {
  const primary = rowsToForecasts(
    [
      ...rows('BOTH', { asOf: '2026-07-13', model: 'consumo', yhat: 9 }),
      ...rows('ONLY-PRIMARY', { asOf: '2026-07-13', model: 'consumo', yhat: 7 }),
    ],
    'consumo-diario',
  );
  const fallback = rowsToForecasts(
    [
      ...rows('BOTH', { asOf: '2026-07-20', model: 'sop', yhat: 3 }),
      ...rows('ONLY-SOP', { asOf: '2026-07-20', model: 'sop', yhat: 1 }),
    ],
    'sop',
  );
  const merged = coalesceForecasts(primary, fallback);

  it('present in both → PRIMARY wins even when its as_of is older', () => {
    const fc = merged.get('BOTH')!;
    expect(fc.source).toBe('consumo-diario');
    expect(fc.modelVersion).toBe('consumo');
    expect(fc.points[0].yhat).toBe(9);
    expect(fc.asOfDate).toBe('2026-07-13'); // older than the sop 07-20, still preferred
  });

  it('only in primary → primary', () => {
    expect(merged.get('ONLY-PRIMARY')!.source).toBe('consumo-diario');
  });

  it('only in fallback → sop', () => {
    const fc = merged.get('ONLY-SOP')!;
    expect(fc.source).toBe('sop');
    expect(fc.points[0].yhat).toBe(1);
  });

  it('covers the union of both SKU sets', () => {
    expect(new Set(merged.keys())).toEqual(new Set(['BOTH', 'ONLY-PRIMARY', 'ONLY-SOP']));
  });

  it('does not mutate the input maps', () => {
    expect(primary.size).toBe(2);
    expect(fallback.size).toBe(2);
  });
});

describe('rowsToOneForecast / coalesceOne', () => {
  it('rowsToOneForecast returns the single SKU or null', () => {
    const r = rows('S', { asOf: '2026-07-13' });
    expect(rowsToOneForecast(r, 'S', 'sop')!.skuBase).toBe('S');
    expect(rowsToOneForecast(r, 'MISSING', 'sop')).toBeNull();
    expect(rowsToOneForecast([], 'S', 'sop')).toBeNull();
  });

  it('coalesceOne prefers primary, then fallback, then null', () => {
    const p = rowsToOneForecast(rows('S', { asOf: '2026-07-13', model: 'consumo' }), 'S', 'consumo-diario');
    const f = rowsToOneForecast(rows('S', { asOf: '2026-07-20', model: 'sop' }), 'S', 'sop');
    expect(coalesceOne(p, f)!.source).toBe('consumo-diario');
    expect(coalesceOne(null, f)!.source).toBe('sop');
    expect(coalesceOne(null, null)).toBeNull();
  });
});

describe('maxAsOf', () => {
  it('returns the freshest as_of across maps', () => {
    const a = rowsToForecasts(rows('A', { asOf: '2026-07-13' }), 'consumo-diario');
    const b = rowsToForecasts(rows('B', { asOf: '2026-07-20' }), 'sop');
    expect(maxAsOf(a, b)).toBe('2026-07-20');
    expect(maxAsOf(new Map())).toBe('');
  });
});
