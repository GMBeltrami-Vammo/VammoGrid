import { describe, expect, it } from 'vitest';
import type { HubId, ProjectionPoint, SkuPolicy, StockProjection, StockState } from '@/types/planning';
import { addDays, nextFirstOfMonth } from './dates';
import { findElaborationTrigger, suggestModalQuantities } from './elaboration';

// Deterministic fixtures: stock starts at `start`, declines by `demand`/day (no
// inbound), so DOH(day k) = (start − demand·k)/demand = start/demand − k. With
// start=100, demand=1 → DOH crosses below 75 first at day 26 (DOH 74).
function projection(today: string, start = 100, demand = 1, horizon = 150): StockProjection {
  const timeline: ProjectionPoint[] = Array.from({ length: horizon + 1 }, (_, day) => {
    const stock = Math.max(0, start - demand * day);
    return {
      date: addDays(today, day),
      day,
      stock,
      stockLo: stock,
      stockHi: stock,
      demand,
      inbound: 0,
      recovery: 0,
      transferIn: 0,
      transferOut: 0,
      backlog: 0,
      extrapolated: false,
    };
  });
  return {
    skuBase: 'X',
    skuName: 'Peça X',
    scope: 'global',
    currentStock: start,
    dailyDemand: demand,
    dohNow: demand > 0 ? start / demand : null,
    stockoutDate: null,
    daysUntilStockout: null,
    incomingUnits: 0,
    timeline,
  };
}

function stock(): StockState {
  const byHub = { osasco: 100, mooca: 0, sbc: 0 } as Record<HubId, number>;
  return { skuBase: 'X', skuName: 'Peça X', byHub, total: 100, unitPrice: 10, isRepairable: false, category: null, lastUpdated: '2026-06-01' };
}

function policy(seaDays: number, airDays: number): SkuPolicy {
  return {
    skuBase: 'X', leadTimeDays: seaDays, leadTimeSource: 'international-default',
    leadTimeSeaDays: seaDays, leadTimeAirDays: airDays, defaultModal: 'sea', leadTimeStdDays: null,
    abcClass: 'C', targetDoi: 60, recoveryRate: 0, recoveryTurnaroundDays: 14,
    safetyOverride: null, isRepairable: false, updatedBy: null, updatedAt: '2026-06-01',
  };
}

const TODAY = '2026-06-01'; // the 1st → sea can be ordered today

describe('nextFirstOfMonth', () => {
  it('returns today when today is the 1st', () => {
    expect(nextFirstOfMonth('2026-06-01')).toBe('2026-06-01');
  });
  it('returns the 1st of next month otherwise', () => {
    expect(nextFirstOfMonth('2026-06-02')).toBe('2026-07-01');
    expect(nextFirstOfMonth('2026-06-20')).toBe('2026-07-01');
  });
  it('rolls the year over in December', () => {
    expect(nextFirstOfMonth('2026-12-15')).toBe('2027-01-01');
  });
});

describe('findElaborationTrigger', () => {
  it('no order when DOH never drops below the threshold', () => {
    // start high enough that DOH stays >= 75 across the horizon (start 300, demand 1).
    const r = findElaborationTrigger({ stock: stock(), projection: projection(TODAY, 300), policy: policy(10, 5), today: TODAY });
    expect(r.needsOrder).toBe(false);
    expect(r.firstBreachDate).toBeNull();
    expect(r.suggestedModal).toBeNull();
  });

  it('suggests maritime when the monthly sea batch still arrives in time', () => {
    // breach at day 26; sea (today, +10) arrives day 10 ≤ 26 → sea, not late.
    const r = findElaborationTrigger({ stock: stock(), projection: projection(TODAY), policy: policy(10, 5), today: TODAY });
    expect(r.needsOrder).toBe(true);
    expect(r.firstBreachDate).toBe(addDays(TODAY, 26));
    expect(r.suggestedModal).toBe('sea');
    expect(r.suggestedOrderDate).toBe(TODAY);
    expect(r.expectedArrival).toBe(addDays(TODAY, 10));
    expect(r.isLate).toBe(false);
  });

  it('escalates to air when sea is too late but air arrives in time', () => {
    // sea +40 arrives day 40 > 26 (too late); air +10 arrives day 10 ≤ 26 → air, not late.
    const r = findElaborationTrigger({ stock: stock(), projection: projection(TODAY), policy: policy(40, 10), today: TODAY });
    expect(r.needsOrder).toBe(true);
    expect(r.suggestedModal).toBe('air');
    expect(r.suggestedOrderDate).toBe(TODAY);
    expect(r.expectedArrival).toBe(addDays(TODAY, 10));
    expect(r.isLate).toBe(false);
  });

  it('suggests air but flags late when even air cannot beat the breach', () => {
    // both +40 arrive day 40 > 26 → air, late.
    const r = findElaborationTrigger({ stock: stock(), projection: projection(TODAY), policy: policy(40, 40), today: TODAY });
    expect(r.needsOrder).toBe(true);
    expect(r.suggestedModal).toBe('air');
    expect(r.isLate).toBe(true);
  });

  it('uses the next monthly batch (not today) for sea when today is mid-month', () => {
    // today the 20th; breach at day 26 → 2026-06-46 = 2026-07-16. sea order = 2026-07-01,
    // +10 = 2026-07-11 ≤ breach → sea, ordered on the 1st of next month.
    const mid = '2026-06-20';
    const r = findElaborationTrigger({ stock: stock(), projection: projection(mid), policy: policy(10, 5), today: mid });
    expect(r.suggestedModal).toBe('sea');
    expect(r.suggestedOrderDate).toBe('2026-07-01');
    expect(r.expectedArrival).toBe('2026-07-11');
  });

  it('honours a custom DOH threshold (criteria.dohThreshold)', () => {
    // start=100, demand=1 → DOH(d)=100−d. Threshold 90 → breach at day 11 (DOH 89).
    const r = findElaborationTrigger({
      stock: stock(),
      projection: projection(TODAY),
      policy: policy(10, 5),
      today: TODAY,
      criteria: { mode: 'doh', dohThreshold: 90 },
    });
    expect(r.needsOrder).toBe(true);
    expect(r.firstBreachDate).toBe(addDays(TODAY, 11));
  });

  it('ROP mode: breaches when projected stock falls below the reorder point', () => {
    // start=100, demand=1 → stock(d)=100−d. rop=40 → stock<40 first at day 61 (stock 39).
    const r = findElaborationTrigger({
      stock: stock(),
      projection: projection(TODAY),
      policy: policy(10, 5),
      today: TODAY,
      criteria: { mode: 'rop', dohThreshold: 75 },
      rop: 40,
    });
    expect(r.needsOrder).toBe(true);
    expect(r.firstBreachDate).toBe(addDays(TODAY, 61));
  });

  it('ROP mode: no order when rop is 0 (undefined reorder point)', () => {
    const r = findElaborationTrigger({
      stock: stock(),
      projection: projection(TODAY),
      policy: policy(10, 5),
      today: TODAY,
      criteria: { mode: 'rop', dohThreshold: 75 },
      rop: 0,
    });
    expect(r.needsOrder).toBe(false);
  });
});

describe('suggestModalQuantities (combined air+sea plan)', () => {
  // start=100, demand=1 → stock(d)=100−d (clamped ≥0), DOH(d)=stock(d). Floor 75.
  it('no air when the monthly sea order lands before any breach', () => {
    // sea 10d, air 5d, today the 1st → sea arrives day 10 (< breach day 26). Air not needed.
    const q = suggestModalQuantities({
      projection: projection(TODAY),
      policy: policy(10, 5),
      today: TODAY,
      dohThreshold: 75,
    });
    expect(q.airQty).toBe(0);
    // Sea tops up to (75+30) days of cover at arrival (day 10, stock 90): 105 − 90 = 15.
    expect(q.seaQty).toBe(15);
  });

  it('air bridges the gap when sea is slow', () => {
    // sea 120d (arrives day 120), air 10d. Breach at day 26; stock hits 0 by day 100.
    const q = suggestModalQuantities({
      projection: projection(TODAY),
      policy: policy(120, 10),
      today: TODAY,
      dohThreshold: 75,
    });
    // Deepest shortfall below the 75 line in [10,120] = 75 − 0 = 75.
    expect(q.airQty).toBe(75);
    // Sea top-up at day 120 (stock 0): (75+30) − 0 = 105.
    expect(q.seaQty).toBe(105);
  });
});
