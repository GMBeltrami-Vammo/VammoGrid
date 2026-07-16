import { describe, expect, it } from 'vitest';
import { buildPrevReal } from './prevReal';

const ARGS = {
  asOfDate: '2026-07-10',
  today: '2026-07-13',
  forecastPoints: [
    { date: '2026-07-10', yhat: 10 },
    { date: '2026-07-11', yhat: 10 },
    { date: '2026-07-12', yhat: 10 },
    { date: '2026-07-13', yhat: 10 },
  ],
  consumption: [
    { date: '2026-07-11', qty: 8 },
    { date: '2026-07-12', qty: 12 },
  ],
  history: [
    { date: '2026-07-10', stock: 100 },
    { date: '2026-07-11', stock: 92 },
    { date: '2026-07-12', stock: 80 },
  ],
};

describe('buildPrevReal', () => {
  it('builds a daily demand series over [asOf, today]', () => {
    const { demand } = buildPrevReal(ARGS);
    expect(demand.map((d) => d.date)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']);
    expect(demand[0]).toEqual({ date: '2026-07-10', prev: 10, real: 0 }); // no ledger row → 0 used
    expect(demand[1]).toEqual({ date: '2026-07-11', prev: 10, real: 8 });
    expect(demand[2]).toEqual({ date: '2026-07-12', prev: 10, real: 12 });
  });

  it('projects stock from the on-hand at as_of minus cumulative forecast (floored)', () => {
    const { stock } = buildPrevReal(ARGS);
    // anchor 100 @ 07-10; proj: 90, 80, 70, 60. real from history where present.
    expect(stock.map((s) => s.prev)).toEqual([90, 80, 70, 60]);
    expect(stock.map((s) => s.real)).toEqual([100, 92, 80, null]);
  });

  it('floors the projected stock at 0', () => {
    const { stock } = buildPrevReal({
      ...ARGS,
      forecastPoints: ARGS.forecastPoints.map((p) => ({ ...p, yhat: 60 })),
    });
    expect(stock.map((s) => s.prev)).toEqual([40, 0, 0, 0]);
  });

  it('computes Σreal ÷ Σprev over elapsed days with a forecast', () => {
    // elapsed = 10,11,12,13 (today). prev sum 40; real 0+8+12+0 = 20 → 0.5
    const { demandRatio } = buildPrevReal(ARGS);
    expect(demandRatio).toBeCloseTo(0.5, 10);
  });

  it('no history → empty stock series', () => {
    const { stock } = buildPrevReal({ ...ARGS, history: [] });
    expect(stock).toEqual([]);
  });

  it('no forecast → null ratio', () => {
    const { demandRatio } = buildPrevReal({ ...ARGS, forecastPoints: [] });
    expect(demandRatio).toBeNull();
  });

  it('window [emissão → ETA]: realized is null in the future, prev keeps projecting (Notas P4)', () => {
    const { demand, stock, elapsedDays, totalDays } = buildPrevReal({
      ...ARGS,
      windowStart: '2026-07-10',
      windowEnd: '2026-07-15', // 2 days past today (07-13)
    });
    expect(demand.map((d) => d.date)).toEqual([
      '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
    ]);
    // Future days (> today) have no realized consumption yet → null.
    expect(demand[4].real).toBeNull();
    expect(demand[5].real).toBeNull();
    // …but the forecast is absent past the frozen run, so prev is null there too here.
    expect(demand[4].prev).toBeNull();
    // Realized stock is null in the future; projection continues from the anchor.
    expect(stock[4].real).toBeNull();
    expect(stock[5].real).toBeNull();
    expect(elapsedDays).toBe(4); // 07-10..07-13
    expect(totalDays).toBe(6); // 07-10..07-15
  });

  it('defaults the window to [asOf, today] when not given', () => {
    const { totalDays, elapsedDays } = buildPrevReal(ARGS);
    expect(totalDays).toBe(4);
    expect(elapsedDays).toBe(4);
  });
});
