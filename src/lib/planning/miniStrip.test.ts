import { describe, expect, it } from 'vitest';
import {
  minDohWithin,
  projectFromSeed,
  sampleMiniStrip,
  suggestCascadeQuantities,
  type MiniProjSeed,
} from './miniStrip';
import { forwardAvgDemand } from './projection';
import type { ModalPlan } from './elaboration';

// The client-side engine-reuse core behind the builder's mini-heatmap + DOH filter.
// stock starts at `start`, declines 1/day (no baseline receipts) → DOH(d) = start − d.
function seed(start = 100, H = 119): MiniProjSeed {
  return {
    startStock: start,
    demandYhat: Array.from({ length: H + 1 }, (_, d) => (d === 0 ? 0 : 1)),
    modelHorizon: 90,
    receipts: {},
    recoveryRate: 0,
    recoveryTurnaround: 14,
    isRepairable: false,
    horizon: H,
  };
}

const TODAY = '2026-07-13';

describe('projectFromSeed', () => {
  it('baseline (no injection) walks stock down by demand', () => {
    const proj = projectFromSeed(seed(100), [], TODAY);
    expect(proj.timeline[0].stock).toBe(100);
    expect(proj.timeline[10].stock).toBe(90);
    expect(proj.timeline[100].stock).toBe(0);
  });

  it('an injected receipt raises stock from its arrival day (N-modal = N receipts)', () => {
    const base = projectFromSeed(seed(100), [], TODAY);
    const withOrder = projectFromSeed(seed(100), [{ offset: 45, qty: 300 }], TODAY);
    expect(withOrder.timeline[44].stock).toBe(base.timeline[44].stock); // before arrival: same
    expect(withOrder.timeline[45].stock).toBe(base.timeline[45].stock + 300); // +qty at arrival
    // com > sem for the rest of the horizon
    expect(withOrder.timeline[100].stock).toBeGreaterThan(base.timeline[100].stock);
  });

  it('multiple modal arrivals stack (courier + aéreo + marítimo)', () => {
    const p = projectFromSeed(seed(50), [
      { offset: 15, qty: 100 },
      { offset: 45, qty: 200 },
      { offset: 105, qty: 500 },
    ], TODAY);
    // by day 105: 50 − 105 + 100 + 200 + 500 = 745
    expect(p.timeline[105].stock).toBe(745);
  });

  it('floors at 0 (lost-sales) like the real engine', () => {
    const p = projectFromSeed(seed(10), [], TODAY);
    expect(p.timeline[50].stock).toBe(0);
    expect(p.timeline[50].stock).toBeGreaterThanOrEqual(0);
  });
});

describe('sampleMiniStrip', () => {
  it('DOH per week matches forwardAvgDemand and flags low/out', () => {
    const proj = projectFromSeed(seed(100), [], TODAY);
    const offsets = [0, 7, 30, 105];
    const cells = sampleMiniStrip(proj, offsets, 75);
    for (const c of cells) {
      const rate = forwardAvgDemand(proj.timeline, c.offset, 7);
      expect(c.doh).toBe(rate > 0 ? Math.round(proj.timeline[c.offset].stock / rate) : null);
    }
    expect(cells[0].isLow).toBe(false); // offset 0: DOH 100 ≥ 75
    expect(cells[2].isLow).toBe(true); // offset 30: stock 70, DOH 70 < 75
    expect(cells[3].isOut).toBe(true); // offset 105: stock 0
  });
});

describe('minDohWithin', () => {
  it('returns the lowest DOH over the horizon (drives the coverage+minDOH filter)', () => {
    const proj = projectFromSeed(seed(100), [], TODAY);
    // Over [0..30], DOH falls from 100 to 70 → min ≈ 70.
    const m = minDohWithin(proj, 30);
    expect(m).not.toBeNull();
    expect(Math.round(m!)).toBe(70);
  });

  it('a big early order keeps min DOH high (no dip within horizon)', () => {
    const proj = projectFromSeed(seed(100), [{ offset: 5, qty: 1000 }], TODAY);
    expect(minDohWithin(proj, 60)!).toBeGreaterThan(75);
  });
});

// The Novo Pedido cascade — the fix for the reported VM-07-CARA-1101 case: aéreo showed
// ~34 DOH where 75 was expected because the old engine sized each lane against ONE static,
// floored baseline. suggestCascadeQuantities re-projects after each lane instead.
describe('suggestCascadeQuantities', () => {
  // DOH hoje 48, demand 1/day → baseline stocks out ~day 48 (week 7). Long horizon so the
  // 7-day forward window stays full (rate = 1) through day 105.
  const scenario = () => seed(48, 140);
  const doh = (proj: ReturnType<typeof projectFromSeed>, d: number) =>
    proj.timeline[d].stock / forwardAvgDemand(proj.timeline, d, 7);

  it('holds each faster lane piso until the NEXT lane arrives (re-projects the floored walk)', () => {
    const s = scenario();
    const plans: ModalPlan[] = [
      { modal: { id: 'courier', name: 'Courier', leadDays: 15 }, minDoh: 75, cadenceDays: null, enabled: true },
      { modal: { id: 'air', name: 'Aéreo', leadDays: 45 }, minDoh: 75, cadenceDays: null, enabled: true },
      { modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: 30, enabled: true },
    ];
    const q = suggestCascadeQuantities({ seed: s, plans, today: TODAY });
    expect(q.map((x) => x.modalId)).toEqual(['courier', 'air', 'sea']); // fastest→slowest
    // Courier holds 75 to day 45; aéreo holds 75 to day 105; marítimo order-up-to (75+30).
    expect(q.map((x) => x.qty)).toEqual([72, 60, 30]);

    const proj = projectFromSeed(s, q.map((x) => ({ offset: x.arrivalOffset, qty: x.qty })), TODAY);
    expect(doh(proj, 44)).toBeGreaterThanOrEqual(75); // just before aéreo — courier held it
    expect(doh(proj, 104)).toBeGreaterThanOrEqual(75); // just before marítimo — aéreo held it (was ~34)
  });

  it('regression: a single deepest-shortfall injection (old engine) under-covers past stockout', () => {
    const s = scenario();
    // The old engine sized aéreo alone as deepest (75·rate − flooredStock) over [45,105] = 75.
    // Injected at day 45 it depletes across the window → ~19 DOH at day 104 (the reported bug).
    const naive = projectFromSeed(s, [{ offset: 45, qty: 75 }], TODAY);
    expect(doh(naive, 104)).toBeLessThan(40);
    // The cascade sizes aéreo to actually hold its floor to the end.
    const q = suggestCascadeQuantities({
      seed: s,
      plans: [
        { modal: { id: 'air', name: 'Aéreo', leadDays: 45 }, minDoh: 75, cadenceDays: null, enabled: true },
        { modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: 30, enabled: true },
      ],
      today: TODAY,
    });
    const air = q.find((x) => x.modalId === 'air')!.qty;
    const fixed = projectFromSeed(s, [{ offset: 45, qty: air }], TODAY);
    expect(doh(fixed, 104)).toBeGreaterThanOrEqual(75);
  });

  it('single modal = order-up-to (piso + cadência) at its arrival', () => {
    const q = suggestCascadeQuantities({
      seed: scenario(),
      plans: [{ modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: 30, enabled: true }],
      today: TODAY,
    });
    expect(q).toHaveLength(1);
    // baseline stock(105)=0 → order-up-to (75+30)·1 = 105 coverage AT day 105; the re-projection
    // subtracts that day's own demand (1) too, so 106 units land exactly 105 DOH at arrival.
    expect(q[0].qty).toBe(106);
  });

  it('disabled modals are ignored; empty when none enabled', () => {
    const s = scenario();
    const q = suggestCascadeQuantities({
      seed: s,
      plans: [
        { modal: { id: 'air', name: 'Aéreo', leadDays: 45 }, minDoh: 75, cadenceDays: null, enabled: false },
        { modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: 30, enabled: true },
      ],
      today: TODAY,
    });
    expect(q.map((x) => x.modalId)).toEqual(['sea']);
    expect(suggestCascadeQuantities({ seed: s, plans: [], today: TODAY })).toEqual([]);
  });

  it('a bigger cadence grows the slowest lane order-up-to', () => {
    const s = scenario();
    const plan = (cad: number): ModalPlan[] => [
      { modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: cad, enabled: true },
    ];
    const c30 = suggestCascadeQuantities({ seed: s, plans: plan(30), today: TODAY })[0].qty;
    const c60 = suggestCascadeQuantities({ seed: s, plans: plan(60), today: TODAY })[0].qty;
    expect(c60).toBe(c30 + 30);
  });

  it('wide bridge window (low piso, far next lane) is sized exactly — no iteration-cap under-order', () => {
    // Air arrival 15 (piso 20), Sea (slowest) arrival 300 → a ~285-day bridge that stays
    // stocked-out at its deepest point. An iterative fixed-point adding piso·rate per floored
    // round would cap out (8·20=160) and leave DOH at 0 across most of the window; the closed
    // form sizes it to actually hold 20 DOH all the way to the sea arrival.
    const s = seed(48, 320);
    const q = suggestCascadeQuantities({
      seed: s,
      plans: [
        { modal: { id: 'air', name: 'Aéreo', leadDays: 15 }, minDoh: 20, cadenceDays: null, enabled: true },
        { modal: { id: 'sea', name: 'Marítimo', leadDays: 300 }, minDoh: 75, cadenceDays: 30, enabled: true },
      ],
      today: TODAY,
    });
    const air = q.find((x) => x.modalId === 'air')!.qty;
    expect(air).toBeGreaterThan(160); // an 8-iter cap would have stopped at ~160
    const proj = projectFromSeed(s, [{ offset: 15, qty: air }], TODAY);
    for (let d = 15; d <= 300; d++) expect(doh(proj, d)).toBeGreaterThanOrEqual(19);
  });

  it('layered low pisos: the faster lane holds its (lower) floor even when it re-floors mid-window', () => {
    const s = scenario();
    const q = suggestCascadeQuantities({
      seed: s,
      plans: [
        { modal: { id: 'air', name: 'Aéreo', leadDays: 45 }, minDoh: 30, cadenceDays: null, enabled: true },
        { modal: { id: 'sea', name: 'Marítimo', leadDays: 105 }, minDoh: 75, cadenceDays: 30, enabled: true },
      ],
      today: TODAY,
    });
    const air = q.find((x) => x.modalId === 'air')!.qty;
    const proj = projectFromSeed(s, [{ offset: 45, qty: air }], TODAY);
    for (let d = 45; d <= 104; d++) expect(doh(proj, d)).toBeGreaterThanOrEqual(29); // ≥ 30 (−1 slack)
  });
});
