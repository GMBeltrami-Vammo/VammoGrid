import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  HubId,
  OpenPurchaseOrder,
  PurchaseSuggestion,
  SkuForecast,
  SkuPolicy,
  StockState,
} from '@/types/planning';
import type { PurchaseCriteria } from './constants';
import { addDays } from './dates';
import { forwardAvgDemand } from './projection';
import { purchaseForSku } from './purchase';
import type { ModalOption } from './supplierGroups';
import { buildAllScenarioGrids, type ScenarioGrids, type WeekGrid } from './weekgrid';

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION / REGRESSION GATE for the weekgrid engine.
//
// Frozen BEFORE the performance refactor (decisions.MD #19): the serialized output
// of buildAllScenarioGrids over these fixtures must stay IDENTICAL through every
// optimization step (forwardAvgDemand fast path, projectGlobal, horizon threading,
// baseline sharing). One case is snapshotted in full (diff-able); the rest of the
// criteria × weeks matrix is pinned by SHA-256 digest of the same serialization.
// The serialization sorts nothing and covers every meta + cell field, so it is a
// value-identity check independent of object key order.
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = '2026-06-23';
const SCOPES: ('global' | HubId)[] = ['global', 'osasco', 'mooca', 'sbc'];

function forecast(skuBase: string, yhat: number, hi: number, days = 150): SkuForecast {
  return {
    skuBase,
    asOfDate: TODAY,
    abcClass: 'C',
    modelVersion: 'test',
    horizonDays: days,
    points: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      date: addDays(TODAY, i + 1),
      yhat,
      lo: Math.max(0, yhat - (hi - yhat)),
      hi,
    })),
  };
}

function stock(
  skuBase: string,
  skuName: string,
  byHub: Record<HubId, number>,
  isRepairable = false,
): StockState {
  return {
    skuBase,
    skuName,
    byHub,
    total: byHub.osasco + byHub.mooca + byHub.sbc,
    unitPrice: 10,
    isRepairable,
    category: null,
    lastUpdated: TODAY,
  };
}

function policy(skuBase: string, over: Partial<SkuPolicy> = {}): SkuPolicy {
  return {
    skuBase,
    leadTimeDays: 10,
    leadTimeSource: 'international-default',
    leadTimeSeaDays: 20,
    leadTimeAirDays: 5,
    defaultModal: 'sea',
    leadTimeStdDays: null,
    abcClass: 'C',
    targetDoi: 60,
    recoveryRate: 0,
    recoveryTurnaroundDays: 14,
    safetyOverride: null,
    isRepairable: false,
    updatedBy: null,
    updatedAt: TODAY,
    ...over,
  };
}

let poSeq = 0;
function po(
  skuBase: string,
  etaOffset: number,
  over: Partial<OpenPurchaseOrder> = {},
): OpenPurchaseOrder {
  poSeq += 1;
  return {
    id: `po-${poSeq}`,
    vo: `VO-${poSeq}`,
    skuCode: skuBase,
    skuBase,
    skuName: skuBase,
    qty: 40,
    orderDate: TODAY,
    eta: addDays(TODAY, etaOffset),
    leadTimeDays: 10,
    modal: 'sea',
    status: 'ordered',
    prepStatus: null,
    hubId: 'osasco',
    source: 'test',
    orderType: null,
    ...over,
  };
}

// ── Fixture: 4 SKUs exercising every engine branch ───────────────────────────

// 1. Zero demand — never breaches (exercises the baseline-row-reuse path later).
const zeroStock = stock('SKU-ZERO', 'Zero Demand', { osasco: 80, mooca: 10, sbc: 10 });

// 2. Steady demand breaching mid-grid, with boundary-ETA POs pinning the week
//    bucketing: today (0), 1, 7, 8, 56 (8w end), 57 (just past 8w grid), past ETA,
//    a draft (non-inbound prepStatus), a cancelled one, air + sea, and vo:null.
const steadyStock = stock('SKU-STEADY', 'Steady Breacher', { osasco: 300, mooca: 100, sbc: 50 });
const steadyOrders: OpenPurchaseOrder[] = [
  po('SKU-STEADY', 0),
  po('SKU-STEADY', 1, { modal: 'air', qty: 15 }),
  po('SKU-STEADY', 7, { vo: null }),
  po('SKU-STEADY', 8, { modal: 'air', qty: 25 }),
  po('SKU-STEADY', 56),
  po('SKU-STEADY', 57, { qty: 60 }),
  po('SKU-STEADY', -3, { qty: 10 }),
  po('SKU-STEADY', 14, { prepStatus: 'elaborado', qty: 99 }), // draft → not inbound
  po('SKU-STEADY', 21, { status: 'cancelled', qty: 77 }), // cancelled → ignored
  // ETA null → falls back to orderDate + leadTimeDays (10)
  po('SKU-STEADY', 0, { eta: null, leadTimeDays: 12, qty: 20 }),
];

// 3. Repairable with recovery inflow.
const repairStock = stock('SKU-REPAIR', 'Repairable Part', { osasco: 120, mooca: 40, sbc: 40 }, true);

// 4. Long sea lead + heavy demand + low stock → multiple injections; sea arrival
//    beyond the grid; complete-scenario sea/air fallback.
const seaLeadStock = stock('SKU-SEALEAD', 'Long Sea Lead', { osasco: 80, mooca: 20, sbc: 0 });

function buildInputs() {
  const stocks = [zeroStock, steadyStock, repairStock, seaLeadStock];
  const forecasts = new Map<string, SkuForecast>([
    ['SKU-STEADY', forecast('SKU-STEADY', 5, 7)],
    ['SKU-REPAIR', forecast('SKU-REPAIR', 4, 6)],
    ['SKU-SEALEAD', forecast('SKU-SEALEAD', 10, 14)],
  ]);
  const policies = new Map<string, SkuPolicy>([
    ['SKU-ZERO', policy('SKU-ZERO')],
    ['SKU-STEADY', policy('SKU-STEADY')],
    ['SKU-REPAIR', policy('SKU-REPAIR', { recoveryRate: 0.5, recoveryTurnaroundDays: 5, isRepairable: true })],
    ['SKU-SEALEAD', policy('SKU-SEALEAD', { leadTimeSeaDays: 110, leadTimeAirDays: 40, targetDoi: 30 })],
  ]);
  const ordersBySku = new Map<string, OpenPurchaseOrder[]>([['SKU-STEADY', steadyOrders]]);
  const shares = new Map<string, Record<HubId, number>>([
    ['SKU-STEADY', { osasco: 0.5, mooca: 0.3, sbc: 0.2 }],
  ]);
  // One SKU with an explicit 3-modal supplier (Courier/Aéreo/Marítimo) so the N-modal
  // scenario set + per-modal arrivals are exercised; the rest fall back to policy sea/air.
  const modalsBySku = new Map<string, ModalOption[]>([
    [
      'SKU-STEADY',
      [
        { id: 'Courier', name: 'Courier', leadDays: 15 },
        { id: 'Aéreo', name: 'Aéreo', leadDays: 45 },
        { id: 'Marítimo', name: 'Marítimo', leadDays: 105 },
      ],
    ],
  ]);

  // Real purchase suggestions (status/isLate/buyBy/rop), exactly like production.
  const purchases: PurchaseSuggestion[] = stocks.map((s) =>
    purchaseForSku({
      skuBase: s.skuBase,
      skuName: s.skuName,
      forecast: forecasts.get(s.skuBase) ?? null,
      stock: s,
      orders: ordersBySku.get(s.skuBase) ?? [],
      policy: policies.get(s.skuBase)!,
      today: TODAY,
    }),
  );

  return { inputs: { stocks, forecasts, ordersBySku, policies, shares, today: TODAY, modalsBySku }, purchases };
}

// ── Deterministic full-fidelity serialization (key-order independent) ─────────

function serializeGrid(grid: WeekGrid): string[] {
  const lines: string[] = [];
  lines.push(
    `scenario=${grid.scenario} dohFloor=${grid.dohFloor} criteria=${grid.criteria.mode}/${grid.criteria.dohThreshold}`,
  );
  lines.push(`weeks=${grid.weeks.map((w) => `${w.idx}:${w.dayOffset}:${w.endDate}`).join(' ')}`);
  for (const scope of SCOPES) {
    const rows = scope === 'global' ? grid.global : grid.byHub[scope];
    for (const r of rows) {
      lines.push(
        `[${scope}] ${r.skuBase} name=${r.skuName} lead=${r.leadTimeSource} modal=${r.defaultModal} ` +
          `dd=${r.dailyDemand} status=${r.status} late=${r.isLate} buyBy=${r.buyByWeekIdx}`,
      );
      r.cells.forEach((c, i) => {
        const arr = c.arrivals.map((a) => `${a.modal}:${a.reg}/${a.sug}`).join(',');
        lines.push(
          `  w${i + 1} stock=${c.stock} doh=${c.doh} in=${c.inbound} arr=[${arr}] vos=[${c.arrVos.join(',')}] ` +
            `rec=${c.recovery} nat=${c.arrNat} out=${c.isOut} low=${c.isLow} x=${c.extrapolated}`,
        );
      });
    }
  }
  return lines;
}

function serializeAll(result: ScenarioGrids): string {
  return [
    `scenarios=${result.scenarios.map((s) => `${s.key}(${s.kind})`).join('|')}`,
    ...result.scenarios.flatMap((s) => serializeGrid(result.grids[s.key])),
  ].join('\n');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const DOH: PurchaseCriteria = { mode: 'doh', dohThreshold: 75 };
const ROP: PurchaseCriteria = { mode: 'rop', dohThreshold: 75 };

describe('buildAllScenarioGrids — characterization (regression gate)', () => {
  it('doh criteria, 8 weeks — full snapshot', () => {
    const { inputs, purchases } = buildInputs();
    const grids = buildAllScenarioGrids({ inputs, purchases, weeks: 8, criteria: DOH });
    expect(serializeAll(grids).split('\n')).toMatchSnapshot();
  });

  it('rop criteria, 8 weeks — digest', () => {
    const { inputs, purchases } = buildInputs();
    const grids = buildAllScenarioGrids({ inputs, purchases, weeks: 8, criteria: ROP });
    expect(sha256(serializeAll(grids))).toMatchSnapshot();
  });

  it('doh criteria, 20 weeks — digest', () => {
    const { inputs, purchases } = buildInputs();
    const grids = buildAllScenarioGrids({ inputs, purchases, weeks: 20, criteria: DOH });
    expect(sha256(serializeAll(grids))).toMatchSnapshot();
  });

  it('rop criteria, 20 weeks — digest', () => {
    const { inputs, purchases } = buildInputs();
    const grids = buildAllScenarioGrids({ inputs, purchases, weeks: 20, criteria: ROP });
    expect(sha256(serializeAll(grids))).toMatchSnapshot();
  });

  it('is deterministic across invocations (serialization is stable)', () => {
    const a = buildInputs();
    const b = buildInputs();
    const ga = buildAllScenarioGrids({ inputs: a.inputs, purchases: a.purchases, weeks: 8, criteria: DOH });
    const gb = buildAllScenarioGrids({ inputs: b.inputs, purchases: b.purchases, weeks: 8, criteria: DOH });
    expect(serializeAll(ga)).toBe(serializeAll(gb));
  });
});

// ── N-modal scenario behavior (the mega-rodada engine) ───────────────────────
describe('N-modal scenarios — behavioral', () => {
  // SKU-N: 1350 on-hand, 10/day demand → DOH 135−d, breaches the 75 floor at day 61.
  // Modais Courier 15 / Aéreo 45 / Marítimo 105. At the day-61 breach the in-time lanes are
  // Courier(15) and Aéreo(45); the combined scenario must pick the SLOWEST in time (Aéreo).
  const skuN = stock('SKU-N', 'N-modal', { osasco: 1350, mooca: 0, sbc: 0 });
  // SKU-M: only a Marítimo modal → the Courier scenario must leave it at baseline (no sug).
  const skuM = stock('SKU-M', 'Marítimo-só', { osasco: 300, mooca: 0, sbc: 0 });
  const nInputs = {
    stocks: [skuN, skuM],
    forecasts: new Map<string, SkuForecast>([
      ['SKU-N', forecast('SKU-N', 10, 12)],
      ['SKU-M', forecast('SKU-M', 10, 12)],
    ]),
    ordersBySku: new Map<string, OpenPurchaseOrder[]>(),
    policies: new Map<string, SkuPolicy>([
      ['SKU-N', policy('SKU-N', { leadTimeSeaDays: 105, leadTimeAirDays: 45, targetDoi: 60 })],
      ['SKU-M', policy('SKU-M', { leadTimeSeaDays: 105, leadTimeAirDays: 45, targetDoi: 60 })],
    ]),
    shares: new Map<string, Record<HubId, number>>(),
    today: TODAY,
    modalsBySku: new Map<string, ModalOption[]>([
      [
        'SKU-N',
        [
          { id: 'Courier', name: 'Courier', leadDays: 15 },
          { id: 'Aéreo', name: 'Aéreo', leadDays: 45 },
          { id: 'Marítimo', name: 'Marítimo', leadDays: 105 },
        ],
      ],
      ['SKU-M', [{ id: 'Marítimo', name: 'Marítimo', leadDays: 105 }]],
    ]),
  };
  const nPurchases: PurchaseSuggestion[] = nInputs.stocks.map((s) =>
    purchaseForSku({
      skuBase: s.skuBase,
      skuName: s.skuName,
      forecast: nInputs.forecasts.get(s.skuBase) ?? null,
      stock: s,
      orders: [],
      policy: nInputs.policies.get(s.skuBase)!,
      today: TODAY,
    }),
  );
  const { scenarios, grids } = buildAllScenarioGrids({ inputs: nInputs, purchases: nPurchases, weeks: 20, criteria: DOH });

  // First (earliest week) suggested-arrival modal for a SKU in a scenario, or null.
  const firstSug = (key: string, skuBase: string): string | null => {
    const row = grids[key].global.find((r) => r.skuBase === skuBase);
    if (!row) return null;
    for (const c of row.cells) {
      const a = c.arrivals.find((x) => x.sug > 0);
      if (a) return a.modal;
    }
    return null;
  };

  it('the scenario set is baseline + one per modal + combined', () => {
    expect(scenarios.map((s) => s.key)).toEqual(['baseline', 'Courier', 'Aéreo', 'Marítimo', 'combined']);
  });

  it('a per-modal scenario injects via that modal', () => {
    expect(firstSug('Courier', 'SKU-N')).toBe('Courier');
    expect(firstSug('Aéreo', 'SKU-N')).toBe('Aéreo');
    expect(firstSug('Marítimo', 'SKU-N')).toBe('Marítimo');
  });

  it('combined picks the SLOWEST lane arriving in time at the first breach (Aéreo, not Courier)', () => {
    expect(firstSug('combined', 'SKU-N')).toBe('Aéreo');
  });

  it('a SKU whose supplier lacks the modal stays at baseline in that scenario', () => {
    expect(firstSug('Courier', 'SKU-M')).toBeNull(); // SKU-M has no Courier → no suggestion
    expect(firstSug('Marítimo', 'SKU-M')).toBe('Marítimo'); // but it does inject via Marítimo
  });

  it('baseline never suggests', () => {
    expect(firstSug('baseline', 'SKU-N')).toBeNull();
    expect(firstSug('baseline', 'SKU-M')).toBeNull();
  });

  it('order size follows (piso + cadência) — grows with the cadence', () => {
    const firstMaritimoSug = (plan: Record<string, { minDoh?: number; cadenceDays?: number }>): number => {
      const { grids: g } = buildAllScenarioGrids({
        inputs: nInputs,
        purchases: nPurchases,
        weeks: 20,
        criteria: DOH,
        planByModal: plan,
      });
      const row = g['Marítimo'].global.find((r) => r.skuBase === 'SKU-N');
      for (const c of row?.cells ?? []) {
        const a = c.arrivals.find((x) => x.modal === 'Marítimo' && x.sug > 0);
        if (a) return a.sug;
      }
      return 0;
    };
    expect(firstMaritimoSug({ Marítimo: { cadenceDays: 90 } })).toBeGreaterThan(
      firstMaritimoSug({ Marítimo: { cadenceDays: 10 } }),
    );
  });
});

// ── forwardAvgDemand property test (guards the upcoming O(1) fast path) ───────

/** Verbatim copy of the pre-optimization loop — the reference implementation. */
function naiveForwardAvg(timeline: { demand: number }[], fromDay: number, window = 7): number {
  let sum = 0;
  let n = 0;
  for (let k = 1; k <= window; k++) {
    const p = timeline[fromDay + k];
    if (!p) break;
    sum += p.demand;
    n++;
  }
  if (n === 0) return timeline[fromDay]?.demand ?? 0;
  return sum / n;
}

/** Deterministic PRNG (mulberry32) — property test must be reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('forwardAvgDemand — matches the naive reference on random timelines', () => {
  it('agrees with the naive loop across lengths, fromDays and windows', () => {
    const rand = mulberry32(20260703);
    for (let trial = 0; trial < 200; trial++) {
      const len = 1 + Math.floor(rand() * 180);
      const timeline = Array.from({ length: len }, () => ({
        demand: rand() < 0.15 ? 0 : Math.round(rand() * 200) / 10, // include zero days
      }));
      const fromDays = [0, 1, len - 2, len - 1, len, len + 5, Math.floor(rand() * len)];
      for (const fromDay of fromDays) {
        if (fromDay < 0) continue;
        for (const window of [2, 7, 30]) {
          expect(forwardAvgDemand(timeline, fromDay, window)).toBe(
            naiveForwardAvg(timeline, fromDay, window),
          );
        }
        // default window (7)
        expect(forwardAvgDemand(timeline, fromDay)).toBe(naiveForwardAvg(timeline, fromDay));
      }
    }
  });
});
