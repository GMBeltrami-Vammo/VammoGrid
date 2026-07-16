import { describe, expect, it } from 'vitest';
import { minDohWithin, projectFromSeed, sampleMiniStrip, type MiniProjSeed } from './miniStrip';
import { forwardAvgDemand } from './projection';

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
