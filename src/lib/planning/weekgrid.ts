import type {
  HubId,
  OpenPurchaseOrder,
  ProjectionScope,
  PurchaseSuggestion,
  ScenarioMeta,
  SkuForecast,
  SkuPolicy,
  StockProjection,
  StockState,
  WeekArrival,
  WeekCell,
  WeekGridRow,
  WeekGridScenario,
  WeekMeta,
} from '@/types/planning';
import { countsAsInbound } from '@/types/planning';
import { resolveShares } from './allocation';
import {
  DEFAULT_LEAD_TIME_DAYS,
  HORIZON_DAYS,
  INTERNATIONAL_AIR_LEAD_DAYS,
  DEFAULT_PURCHASE_CRITERIA,
  type PurchaseCriteria,
} from './constants';
import { addDays, diffDays } from './dates';
import { defaultPolicyFor } from './policy';
import { forwardAvgDemand, projectGlobal, projectSku, type SkuProjections } from './projection';
import type { ModalOption } from './supplierGroups';

// ─────────────────────────────────────────────────────────────────────────────
// Weekly stockout heatmap — a VIEW of the existing projection, sampled at week
// boundaries. All scopes (global + 3 hubs) are computed server-side so the scope
// toggle is instant. Pure/deterministic: reuses projectSku(), so every cell is
// consistent with the SKU-detail charts.
//
// N-modal (mega-rodada): a supplier offers N transport modais (Courier 15d / Aéreo
// 45d / Marítimo 105d…). The scenario SET is dynamic — 'baseline', one per distinct
// modal ("Courier quando necessário"…), and 'combined' — each computed by injecting
// when-needed arrivals at that modal's REAL lead (the old monthly-batch anchor is gone;
// arrivals are plain lead offsets). Cells carry a per-modal arrivals list, so courier /
// aéreo / marítimo show up distinctly. The projection engine ignores `modal` (timing
// comes from eta/lead), so this is purely a matter of which receipts get injected.
// ─────────────────────────────────────────────────────────────────────────────

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];
const DEFAULT_WEEKS = 16;
const MODEL_HORIZON_DAYS = 90; // forecast beyond this is extrapolated (greyed in the UI)

/** Legacy PO modal codes → the display names the supplier modais use, so a synced
 *  'sea'/'air' PO groups under the same bucket as the supplier's Marítimo/Aéreo modal. */
function normalizeModal(m: string | null | undefined): string {
  if (!m) return 'Marítimo';
  const s = String(m).toLowerCase();
  if (s === 'sea') return 'Marítimo';
  if (s === 'air') return 'Aéreo';
  return String(m);
}

export interface WeekGrid {
  weeks: WeekMeta[];
  global: WeekGridRow[];
  byHub: Record<HubId, WeekGridRow[]>;
  scenario: WeekGridScenario;
  /** DOH threshold (days) — the coloring floor when criteria.mode = 'doh'. */
  dohFloor: number;
  /** The active purchase criteria driving the "low"/breach coloring. */
  criteria: PurchaseCriteria;
}

/** buildAllScenarioGrids result: the dynamic scenario list + one grid per scenario key. */
export interface ScenarioGrids {
  scenarios: ScenarioMeta[];
  grids: Record<string, WeekGrid>;
}

interface WeekGridInputs {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  policies: Map<string, SkuPolicy>;
  shares: Map<string, Record<HubId, number>>;
  today: string;
  /** Per-SKU transport modais (from the preferred supplier). Absent → the SKU's policy
   *  sea/air leads become a 2-modal Marítimo/Aéreo fallback. */
  modalsBySku?: Map<string, ModalOption[]>;
}

const OPEN_STATUSES = new Set(['ordered', 'in_transit', 'customs']);

/** Which week column an arrival day-offset lands in. Column 0 is "Hoje" (dayOffset 0
 *  — today and anything overdue, matching the projection's day-0 credit for late
 *  POs); column i ≥ 1 covers offsets [7(i−1)+1 .. 7i]. Pure O(1) index math.
 *  `totalCols` = weeks.length (the Hoje column + N week columns). */
function weekIndexFor(offset: number, totalCols: number): number {
  if (offset <= 0) return 0;
  const wi = Math.ceil(offset / 7);
  return wi < totalCols ? wi : -1;
}

/** modalName → per-week arriving units. */
type ModalWeek = Map<string, number[]>;

function addArrival(map: ModalWeek, modal: string, wi: number, qty: number, weekCount: number): void {
  let arr = map.get(modal);
  if (!arr) {
    arr = new Array<number>(weekCount).fill(0);
    map.set(modal, arr);
  }
  arr[wi] += qty;
}

/** Per-week arriving units grouped by (normalized) modal, from the given orders (same
 *  arrival rule the projection uses). Applied to scopes that receive POs (global + Osasco). */
function arrivalsByModalWeek(orders: OpenPurchaseOrder[], weeks: WeekMeta[], today: string): ModalWeek {
  const out: ModalWeek = new Map();
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    if (!countsAsInbound(o.prepStatus)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    const wi = weekIndexFor(diffDays(today, arrival), weeks.length);
    if (wi === -1) continue;
    addArrival(out, normalizeModal(o.modal), wi, o.qty, weeks.length);
  }
  return out;
}

/** Per-week list of linkable keys (VO, else row id) for the REGISTERED orders arriving
 *  that week — lets the heatmap link a cell to the actual pedido page. */
function registeredKeysByWeek(orders: OpenPurchaseOrder[], weeks: WeekMeta[], today: string): string[][] {
  const out: string[][] = weeks.map(() => []);
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    if (!countsAsInbound(o.prepStatus)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    const wi = weekIndexFor(diffDays(today, arrival), weeks.length);
    if (wi === -1) continue;
    const key = o.vo ?? o.id;
    if (key && !out[wi].includes(key)) out[wi].push(key);
  }
  return out;
}

/** Per-week NATIONAL (nacional) arriving units, from the registered orders — flagged
 *  separately in the heatmap (national emergency purchases vs the international default). */
function nationalArrivalsByWeek(orders: OpenPurchaseOrder[], weeks: WeekMeta[], today: string): number[] {
  const out = weeks.map(() => 0);
  for (const o of orders) {
    if (o.orderType !== 'nacional') continue;
    if (!OPEN_STATUSES.has(o.status)) continue;
    if (!countsAsInbound(o.prepStatus)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    const wi = weekIndexFor(diffDays(today, arrival), weeks.length);
    if (wi === -1) continue;
    out[wi] += o.qty;
  }
  return out;
}

const EMPTY_MODAL_WEEK: ModalWeek = new Map();

/** Sample one scope's projection timeline into per-week cells. `regByModal`/`sugByModal`
 *  are modalName→per-week arriving units for REGISTERED vs SUGGESTED (scenario when-needed)
 *  orders — empty for spoke hubs, which receive no POs. `floor` is the DOH coloring floor
 *  (doh mode); `rop` this scope's reorder point (rop mode). */
function sampleCells(
  proj: StockProjection,
  weeks: WeekMeta[],
  criteria: PurchaseCriteria,
  floor: number,
  rop: number,
  regByModal: ModalWeek,
  sugByModal: ModalWeek,
  arrVosByWeek: string[][],
  natArr: number[],
): WeekCell[] {
  const modalNames = [...new Set([...regByModal.keys(), ...sugByModal.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  return weeks.map((w, wi) => {
    const end = proj.timeline[w.dayOffset];
    const stock = end?.stock ?? 0;
    // DOH = stock ÷ the NEXT 7 days' average daily demand (not the single end-of-week
    // day, which was erratic). Consistent with the SKU-detail chart + breach detection.
    const fwd = forwardAvgDemand(proj.timeline, w.dayOffset, 7);
    // Sum inbound + recovery over the 7 days that make up this week.
    let inbound = 0;
    let recovery = 0;
    for (let d = w.dayOffset - 6; d <= w.dayOffset; d++) {
      const p = proj.timeline[d];
      if (!p) continue;
      inbound += p.inbound;
      recovery += p.recovery;
    }
    const doh = fwd > 0 ? Math.round(stock / fwd) : null;
    const isLow = criteria.mode === 'rop' ? rop > 0 && stock < rop : doh != null && doh < floor;

    const arrivals: WeekArrival[] = [];
    for (const modal of modalNames) {
      const reg = Math.round(regByModal.get(modal)?.[wi] ?? 0);
      const sug = Math.round(sugByModal.get(modal)?.[wi] ?? 0);
      if (reg > 0 || sug > 0) arrivals.push({ modal, reg, sug });
    }
    return {
      stock,
      doh,
      inbound: Math.round(inbound),
      arrivals,
      arrVos: arrVosByWeek[wi] ?? [],
      recovery: Math.round(recovery),
      arrNat: Math.round(natArr[wi] ?? 0),
      isOut: stock <= 0,
      isLow,
      extrapolated: w.dayOffset > MODEL_HORIZON_DAYS,
    };
  });
}

const MAX_INJECTIONS = 6; // cap the when-needed reorder loop per SKU

/** First day (offset 1..horizon) the projection breaches the active criteria; -1 if
 *  never. 'doh' → forward-7-day-avg DOH below `floor`; 'rop' → stock below the reorder
 *  point. So the scenario's when-needed orders target exactly the flagged condition. */
function firstBreachDay(
  proj: StockProjection,
  criteria: PurchaseCriteria,
  floor: number,
  rop: number,
  horizonDays: number,
): number {
  for (let d = 1; d <= horizonDays; d++) {
    const p = proj.timeline[d];
    if (!p) continue;
    if (criteria.mode === 'rop') {
      if (rop > 0 && p.stock < rop) return d;
    } else {
      const fwd = forwardAvgDemand(proj.timeline, d, 7);
      if (fwd <= 0) continue;
      if (p.stock / fwd < floor) return d;
    }
  }
  return -1;
}

/** The SKU's transport modais (fastest→slowest), from its preferred supplier; falls back
 *  to the policy sea/air leads as a 2-modal Marítimo/Aéreo set. */
function modalsForSku(
  modalsBySku: Map<string, ModalOption[]> | undefined,
  skuBase: string,
  policy: SkuPolicy,
): ModalOption[] {
  const own = modalsBySku?.get(skuBase);
  const list =
    own && own.length > 0
      ? [...own]
      : ([
          policy.leadTimeAirDays != null && policy.leadTimeAirDays > 0
            ? { id: 'Aéreo', name: 'Aéreo', leadDays: Math.round(policy.leadTimeAirDays) }
            : null,
          {
            id: 'Marítimo',
            name: 'Marítimo',
            leadDays: Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS),
          },
        ].filter(Boolean) as ModalOption[]);
  return list.sort((a, b) => a.leadDays - b.leadDays); // fastest first
}

/** The dynamic scenario set: baseline + one per distinct modal name (fastest→slowest by a
 *  representative lead) + combined. */
function scenariosFor(contexts: SkuWeekContext[]): ScenarioMeta[] {
  const minLeadByName = new Map<string, number>();
  for (const ctx of contexts) {
    for (const mo of ctx.modais) {
      const cur = minLeadByName.get(mo.name);
      if (cur == null || mo.leadDays < cur) minLeadByName.set(mo.name, mo.leadDays);
    }
  }
  const modalScenarios: ScenarioMeta[] = [...minLeadByName.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => ({ key: name, label: `${name} qdo necessário`, kind: 'modal' as const }));
  const out: ScenarioMeta[] = [{ key: 'baseline', label: 'Base (pedidos atuais)', kind: 'baseline' }];
  out.push(...modalScenarios);
  if (modalScenarios.length > 1) out.push({ key: 'combined', label: 'Combinado', kind: 'combined' });
  return out;
}

/**
 * "Buy when needed" injection, generalized to N modais: repeatedly find the next day the
 * projection drops below the floor and inject an order that lands right when needed. The
 * per-breach lane comes from `pickLane`:
 *   • modal scenario → always that modal (skip the SKU if it doesn't offer it);
 *   • combined → the SLOWEST modal that still arrives ≤ breach, else the FASTEST (late).
 * Returns the injected orders + the per-modal, per-week suggested arrivals for the cells.
 */
function whenNeededInjection(args: {
  scenario: ScenarioMeta;
  modais: ModalOption[];
  stock: StockState;
  forecast: SkuForecast | null;
  policy: SkuPolicy;
  baseOrders: OpenPurchaseOrder[];
  /** The base-orders-only GLOBAL projection (shared) — iteration 0 reuses it. */
  baselineGlobal: StockProjection;
  today: string;
  weeks: WeekMeta[];
  criteria: PurchaseCriteria;
  floor: number;
  rop: number;
  horizonDays: number;
  projectionHorizon: number;
}): { injected: OpenPurchaseOrder[]; sugByModal: ModalWeek } {
  const { scenario, modais, stock, forecast, policy, baseOrders, baselineGlobal, today, weeks } = args;
  const { criteria, floor, rop, horizonDays, projectionHorizon } = args;
  const empty = { injected: [] as OpenPurchaseOrder[], sugByModal: new Map() as ModalWeek };
  if (scenario.kind === 'baseline') return empty;

  // fastest→slowest
  const lanes = [...modais].sort((a, b) => a.leadDays - b.leadDays);
  if (lanes.length === 0) return empty;

  const pickLane = (bd: number): ModalOption | null => {
    if (scenario.kind === 'modal') return lanes.find((m) => m.name === scenario.key) ?? null;
    // combined: slowest lane arriving in time, else the fastest.
    const inTime = lanes.filter((m) => m.leadDays <= bd);
    return inTime.length > 0 ? inTime[inTime.length - 1] : lanes[0];
  };

  const injected: OpenPurchaseOrder[] = [];
  const sugByModal: ModalWeek = new Map();
  const orders = [...baseOrders];

  for (let iter = 0; iter < MAX_INJECTIONS; iter++) {
    const proj =
      iter === 0
        ? baselineGlobal
        : projectGlobal({ stock, forecast, orders, policy, today, horizon: projectionHorizon });
    const bd = firstBreachDay(proj, criteria, floor, rop, horizonDays);
    if (bd < 0) break;
    const lane = pickLane(bd);
    if (!lane) break; // this SKU's supplier doesn't offer the scenario's modal
    const dailyDemand = proj.dailyDemand > 0 ? proj.dailyDemand : proj.timeline[bd]?.demand ?? 0;
    if (dailyDemand <= 0) break;
    const qty = Math.max(1, Math.round(dailyDemand * Math.max(policy.targetDoi, 30)));
    // Land at the breach if the lead allows, else as soon as the lead permits (late).
    const arrivalOffset = lane.leadDays <= bd ? bd : lane.leadDays;
    const ord: OpenPurchaseOrder = {
      id: `scn-${iter}`,
      vo: null,
      skuCode: stock.skuBase,
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      qty,
      orderDate: addDays(today, Math.max(0, arrivalOffset - lane.leadDays)),
      eta: addDays(today, arrivalOffset),
      leadTimeDays: lane.leadDays,
      // Kept as a coarse code for any legacy reader; the engine ignores it and the cell
      // grouping uses the display name below.
      modal: lane.leadDays >= 30 ? 'sea' : 'air',
      status: 'ordered',
      prepStatus: null, // a what-if arrival counts as inbound in the projection
      hubId: 'osasco',
      source: 'scenario',
      orderType: null, // suggested arrivals are the international default, never national
    };
    injected.push(ord);
    orders.push(ord);
    const wi = weekIndexFor(arrivalOffset, weeks.length);
    if (wi !== -1) addArrival(sugByModal, lane.name, wi, qty, weeks.length);
  }
  return { injected, sugByModal };
}

/** Which week column a buy-by date falls in (0 = the "Hoje" column, for buy-by today
 *  or already overdue); null when none / beyond the grid. Matches WeekMeta.idx. */
function buyByWeek(buyByDate: string | null, today: string, weeks: number): number | null {
  if (!buyByDate) return null;
  const offset = diffDays(today, buyByDate);
  if (offset > weeks * 7) return null; // plenty of runway — no flag in the window
  return Math.max(0, Math.ceil(offset / 7)); // past/today → the Hoje column
}

// ── Shared per-page context: everything scenario-INVARIANT, computed once ─────
// The scenario grids share the same weeks, criteria, and — per SKU — the same
// policy/shares/purchase meta, registered arrivals, modais, and (crucially) the same
// base-orders-only projection: baseline IS that projection, and every scenario's
// injection loop starts from it. A SKU that injects nothing in a scenario reuses its
// baseline rows outright.

type ScopeRows = { global: WeekGridRow; byHub: Record<HubId, WeekGridRow> };

interface SkuWeekContext {
  stock: StockState;
  forecast: SkuForecast | null;
  policy: SkuPolicy;
  shares: Record<HubId, number>;
  rop: number;
  modais: ModalOption[];
  baseOrders: OpenPurchaseOrder[];
  /** Base-orders-only projection at the grid horizon — the baseline of every scenario. */
  baseProj: SkuProjections;
  regByModal: ModalWeek;
  regKeys: string[][];
  natArrivals: number[];
  meta: Omit<WeekGridRow, 'cells'>;
  baselineRows: ScopeRows;
}

interface SharedGridContext {
  weekCount: number;
  criteria: PurchaseCriteria;
  dohFloor: number;
  today: string;
  weeks: WeekMeta[];
  projectionHorizon: number;
  noKeys: string[][];
  noNat: number[];
  scenarios: ScenarioMeta[];
  contexts: SkuWeekContext[];
}

function rowsForProjection(
  ctx: SkuWeekContext,
  shared: SharedGridContext,
  proj: SkuProjections,
  sugByModal: ModalWeek,
  floor: number,
): ScopeRows {
  const { weeks, criteria, noKeys, noNat } = shared;
  const rowFor = (p: StockProjection, hasArrivals: boolean, scopeRop: number): WeekGridRow => ({
    ...ctx.meta,
    cells: sampleCells(
      p,
      weeks,
      criteria,
      floor,
      scopeRop,
      hasArrivals ? ctx.regByModal : EMPTY_MODAL_WEEK,
      hasArrivals ? sugByModal : EMPTY_MODAL_WEEK,
      hasArrivals ? ctx.regKeys : noKeys,
      hasArrivals ? ctx.natArrivals : noNat,
    ),
  });
  const byHub = {} as Record<HubId, WeekGridRow>;
  // POs land at Osasco → only the global + Osasco streams see arrivals; spokes get 0.
  for (const h of HUBS) byHub[h] = rowFor(proj.byHub[h], h === 'osasco', ctx.rop * (ctx.shares[h] ?? 0));
  return { global: rowFor(proj.global, true, ctx.rop), byHub };
}

function buildSharedContext(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  criteria?: PurchaseCriteria;
}): SharedGridContext {
  const { inputs } = args;
  const weekCount = args.weeks ?? DEFAULT_WEEKS;
  const criteria = args.criteria ?? DEFAULT_PURCHASE_CRITERIA;
  const today = inputs.today;
  const projectionHorizon = Math.min(HORIZON_DAYS, Math.max(weekCount * 7 + 7, 30));

  const weeks: WeekMeta[] = [
    { idx: 0, dayOffset: 0, endDate: today },
    ...Array.from({ length: weekCount }, (_, i) => {
      const dayOffset = (i + 1) * 7;
      return { idx: i + 1, dayOffset, endDate: addDays(today, dayOffset) };
    }),
  ];
  const noKeys: string[][] = weeks.map(() => []);
  const noNat: number[] = weeks.map(() => 0);

  const purchaseBySku = new Map(args.purchases.map((p) => [p.skuBase, p]));
  const shared: SharedGridContext = {
    weekCount,
    criteria,
    dohFloor: criteria.dohThreshold,
    today,
    weeks,
    projectionHorizon,
    noKeys,
    noNat,
    scenarios: [],
    contexts: [],
  };

  for (const stock of inputs.stocks) {
    const forecast = inputs.forecasts.get(stock.skuBase) ?? null;
    const policy =
      inputs.policies.get(stock.skuBase) ??
      defaultPolicyFor(stock.skuBase, stock, forecast?.abcClass ?? 'C', today);
    const shares = resolveShares(stock, inputs.shares.get(stock.skuBase));
    const purchase = purchaseBySku.get(stock.skuBase);
    const rop = purchase?.rop ?? 0;

    const baseOrders = inputs.ordersBySku.get(stock.skuBase) ?? [];
    const baseProj = projectSku({ stock, forecast, orders: baseOrders, policy, shares, today, horizon: projectionHorizon });

    const meta: Omit<WeekGridRow, 'cells'> = {
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      leadTimeSource: policy.leadTimeSource,
      defaultModal: policy.defaultModal,
      dailyDemand: Math.round((baseProj.global.dailyDemand + Number.EPSILON) * 100) / 100,
      status: purchase?.status ?? 'OK',
      isLate: purchase?.isLate ?? false,
      buyByWeekIdx: buyByWeek(purchase?.buyByDate ?? null, today, weekCount),
      recoveryRate: policy.recoveryRate ?? 0,
      recoveryTurnaroundDays: policy.recoveryTurnaroundDays ?? 0,
      category: stock.category ?? null,
      abcClass: forecast?.abcClass ?? policy.abcClass ?? 'C',
      openPos: baseOrders
        .filter((o) => OPEN_STATUSES.has(o.status) && countsAsInbound(o.prepStatus))
        .map((o) => ({
          id: o.id,
          vo: o.vo,
          eta: o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null),
          qty: o.qty,
          modal: o.modal,
        }))
        .sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? '')),
    };

    const ctx: SkuWeekContext = {
      stock,
      forecast,
      policy,
      shares,
      rop,
      modais: modalsForSku(inputs.modalsBySku, stock.skuBase, policy),
      baseOrders,
      baseProj,
      regByModal: arrivalsByModalWeek(baseOrders, weeks, today),
      regKeys: registeredKeysByWeek(baseOrders, weeks, today),
      natArrivals: nationalArrivalsByWeek(baseOrders, weeks, today),
      meta,
      baselineRows: undefined as unknown as ScopeRows, // set right below
    };
    ctx.baselineRows = rowsForProjection(ctx, shared, baseProj, EMPTY_MODAL_WEEK, criteria.dohThreshold);
    shared.contexts.push(ctx);
  }

  shared.scenarios = scenariosFor(shared.contexts);
  return shared;
}

function buildGridForScenario(shared: SharedGridContext, scenario: ScenarioMeta, floor: number): WeekGrid {
  const { weekCount, criteria, today, weeks, projectionHorizon } = shared;
  const global: WeekGridRow[] = [];
  const byHub: Record<HubId, WeekGridRow[]> = { osasco: [], mooca: [], sbc: [] };
  // Baseline coloring always uses the global criteria floor; scenario floors (sim) recolor.
  const cellFloor = scenario.kind === 'baseline' ? criteria.dohThreshold : floor;

  for (const ctx of shared.contexts) {
    let rows = ctx.baselineRows;
    if (scenario.kind !== 'baseline') {
      const { injected, sugByModal } = whenNeededInjection({
        scenario,
        modais: ctx.modais,
        stock: ctx.stock,
        forecast: ctx.forecast,
        policy: ctx.policy,
        baseOrders: ctx.baseOrders,
        baselineGlobal: ctx.baseProj.global,
        today,
        weeks,
        criteria,
        floor: cellFloor,
        rop: ctx.rop,
        horizonDays: weekCount * 7,
        projectionHorizon,
      });
      if (injected.length > 0) {
        const proj = projectSku({
          stock: ctx.stock,
          forecast: ctx.forecast,
          orders: [...ctx.baseOrders, ...injected],
          policy: ctx.policy,
          shares: ctx.shares,
          today,
          horizon: projectionHorizon,
        });
        rows = rowsForProjection(ctx, shared, proj, sugByModal, cellFloor);
      } else if (cellFloor !== criteria.dohThreshold) {
        // No injection but a different coloring floor (sim) → recolor the baseline rows.
        rows = rowsForProjection(ctx, shared, ctx.baseProj, EMPTY_MODAL_WEEK, cellFloor);
      }
    }
    global.push(rows.global);
    for (const h of HUBS) byHub[h].push(rows.byHub[h]);
  }

  // Sort each scope: earliest stockout first, then by name.
  const firstOutWeek = (r: WeekGridRow) => {
    const i = r.cells.findIndex((c) => c.isOut);
    return i === -1 ? Infinity : i;
  };
  const sortRows = (rows: WeekGridRow[]) =>
    rows.sort((a, b) => firstOutWeek(a) - firstOutWeek(b) || a.skuName.localeCompare(b.skuName, 'pt-BR'));

  sortRows(global);
  for (const h of HUBS) sortRows(byHub[h]);

  return { weeks, global, byHub, scenario: scenario.key, dohFloor: cellFloor, criteria };
}

export function buildWeekGrid(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  scenario?: WeekGridScenario;
  criteria?: PurchaseCriteria;
}): WeekGrid {
  const shared = buildSharedContext(args);
  const key = args.scenario ?? 'baseline';
  const meta = shared.scenarios.find((s) => s.key === key) ?? shared.scenarios[0];
  return buildGridForScenario(shared, meta, shared.criteria.dohThreshold);
}

/** All scenarios in one pass (shared inputs) so the client toggles instantly. The
 *  scenario-invariant work is computed ONCE; scenarios only recompute the SKUs that
 *  actually inject orders. `floorByScenario` (sim) overrides the coloring/injection floor
 *  per scenario key (default = the global criteria threshold). */
export function buildAllScenarioGrids(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  criteria?: PurchaseCriteria;
  floorByScenario?: Record<string, number>;
}): ScenarioGrids {
  const shared = buildSharedContext(args);
  const grids: Record<string, WeekGrid> = {};
  for (const scenario of shared.scenarios) {
    const floor = args.floorByScenario?.[scenario.key] ?? shared.criteria.dohThreshold;
    grids[scenario.key] = buildGridForScenario(shared, scenario, floor);
  }
  return { scenarios: shared.scenarios, grids };
}

// ─── Scope helper (shared label set with the chart components) ────────────────
export type GridScope = ProjectionScope;
