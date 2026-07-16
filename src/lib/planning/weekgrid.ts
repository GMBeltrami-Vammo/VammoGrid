import type {
  HubId,
  OpenPurchaseOrder,
  ProjectionScope,
  PurchaseSuggestion,
  SkuForecast,
  SkuPolicy,
  StockProjection,
  StockState,
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
import { addDays, diffDays, nextFirstOfMonth } from './dates';
import { defaultPolicyFor } from './policy';
import { forwardAvgDemand, projectGlobal, projectSku, type SkuProjections } from './projection';

// ─────────────────────────────────────────────────────────────────────────────
// Weekly stockout heatmap — a VIEW of the existing projection, sampled at week
// boundaries. All four scopes (global + 3 hubs) are computed server-side so the
// scope toggle is instant. Pure/deterministic: reuses projectSku(), so every cell
// is consistent with the SKU-detail charts.
//
// Extended (sub-project C): a coverage SCENARIO can inject a hypothetical air/sea
// order per SKU (baseline/air_only/sea_only/complete — "cobertura do pedido aéreo/
// marítimo"); the low-DOH coloring floor is driven by the global service-level tier;
// and weeks past the model horizon are flagged extrapolated.
// ─────────────────────────────────────────────────────────────────────────────

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];
const DEFAULT_WEEKS = 16;
const MODEL_HORIZON_DAYS = 90; // forecast beyond this is extrapolated (greyed in the UI)

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

interface WeekGridInputs {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  policies: Map<string, SkuPolicy>;
  shares: Map<string, Record<HubId, number>>;
  today: string;
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

/** Per-week arriving units split by modal, from the SKU's orders (same arrival rule
 *  the projection uses). Applied to the scopes that receive POs (global + Osasco). */
function modalArrivalsByWeek(
  orders: OpenPurchaseOrder[],
  weeks: WeekMeta[],
  today: string,
): { sea: number; air: number }[] {
  const out = weeks.map(() => ({ sea: 0, air: 0 }));
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    if (!countsAsInbound(o.prepStatus)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    const wi = weekIndexFor(diffDays(today, arrival), weeks.length);
    if (wi === -1) continue;
    if (o.modal === 'air') out[wi].air += o.qty;
    else out[wi].sea += o.qty; // default/unknown modal counts as maritime
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

type ModalSplit = { sea: number; air: number }[];

/** Sample one scope's projection timeline into per-week cells. `arrReg`/`arrSug` are the
 *  per-week sea/air arrival splits for REGISTERED (already-placed) vs SUGGESTED (scenario
 *  when-needed) orders — zeros for spoke hubs, which receive no POs. `rop` is this scope's
 *  reorder point (used to flag "low" when criteria.mode = 'rop'). */
function sampleCells(
  proj: StockProjection,
  weeks: WeekMeta[],
  criteria: PurchaseCriteria,
  rop: number,
  arrReg: ModalSplit,
  arrSug: ModalSplit,
  arrVosByWeek: string[][],
  natArr: number[],
): WeekCell[] {
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
    // "Low" per the active criteria: below the DOH floor, or below the reorder point.
    const isLow =
      criteria.mode === 'rop' ? rop > 0 && stock < rop : doh != null && doh < criteria.dohThreshold;
    const reg = arrReg[wi] ?? { sea: 0, air: 0 };
    const sug = arrSug[wi] ?? { sea: 0, air: 0 };
    return {
      stock,
      doh,
      inbound: Math.round(inbound),
      inboundSea: Math.round(reg.sea + sug.sea),
      inboundAir: Math.round(reg.air + sug.air),
      arrReg: { sea: Math.round(reg.sea), air: Math.round(reg.air) },
      arrSug: { sea: Math.round(sug.sea), air: Math.round(sug.air) },
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
 *  never. 'doh' → forward-7-day-avg DOH below the threshold (same metric the cells show);
 *  'rop' → stock below the reorder point. So the scenario's when-needed orders target
 *  exactly the condition the heatmap flags. */
function firstBreachDay(
  proj: StockProjection,
  criteria: PurchaseCriteria,
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
      if (p.stock / fwd < criteria.dohThreshold) return d;
    }
  }
  return -1;
}

/** Latest monthly-batch (1st-of-month) sea order whose arrival offset ≤ breach; if
 *  even the first batch lands after the breach, the earliest batch (arriving late). */
function seaArrivalForBreach(today: string, breachOffset: number, seaDays: number): number {
  let earliest = -1;
  let best = -1;
  let cursor = nextFirstOfMonth(today);
  for (let k = 0; k < 24; k++) {
    const arrivalOffset = diffDays(today, cursor) + seaDays;
    if (earliest === -1) earliest = arrivalOffset;
    if (arrivalOffset <= breachOffset) best = arrivalOffset;
    else break; // arrivals only grow month to month
    cursor = nextFirstOfMonth(addDays(cursor, 1));
  }
  return best !== -1 ? best : earliest;
}

/**
 * "Buy when needed" injection (request): instead of a buy-NOW arrival, repeatedly find
 * the next point the projection would drop below the coverage floor and inject an order
 * of the scenario's modal that lands right when needed — air at the breach (ordered
 * breach−airLead, or ASAP if too soon), sea on the latest monthly batch that still
 * arrives in time (else the earliest, late), complete = sea if a batch makes it, else
 * air. Iterates so a long horizon gets successive reorders, like real replenishment.
 */
function whenNeededInjection(args: {
  scenario: WeekGridScenario;
  stock: StockState;
  forecast: SkuForecast | null;
  policy: SkuPolicy;
  baseOrders: OpenPurchaseOrder[];
  /** The base-orders-only GLOBAL projection (shared across scenarios) — iteration 0
   *  of the loop is exactly this projection, so it's reused instead of recomputed. */
  baselineGlobal: StockProjection;
  today: string;
  criteria: PurchaseCriteria;
  rop: number;
  horizonDays: number;
  /** Projection horizon (grid window + fwd-avg margin) — receipts beyond it only
   *  affect days the grid never reads, so results are identical to the 150d default. */
  projectionHorizon: number;
}): OpenPurchaseOrder[] {
  const { scenario, stock, forecast, policy, baseOrders, baselineGlobal, today, criteria, rop, horizonDays, projectionHorizon } = args;
  if (scenario === 'baseline') return [];

  const seaDays = Math.max(0, Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS));
  const airDays = Math.max(0, Math.round(policy.leadTimeAirDays ?? INTERNATIONAL_AIR_LEAD_DAYS));
  const injected: OpenPurchaseOrder[] = [];
  const orders = [...baseOrders];

  for (let iter = 0; iter < MAX_INJECTIONS; iter++) {
    // Only the GLOBAL stream matters here (breach scan) — the hubs were 3/4 wasted work.
    const proj =
      iter === 0
        ? baselineGlobal
        : projectGlobal({ stock, forecast, orders, policy, today, horizon: projectionHorizon });
    const bd = firstBreachDay(proj, criteria, rop, horizonDays);
    if (bd < 0) break;
    const dailyDemand = proj.dailyDemand > 0 ? proj.dailyDemand : proj.timeline[bd]?.demand ?? 0;
    if (dailyDemand <= 0) break;
    // Each order covers targetDoi (≥30) days of demand.
    const qty = Math.max(1, Math.round(dailyDemand * Math.max(policy.targetDoi, 30)));

    // Modal + arrival offset for THIS breach.
    let modal: 'sea' | 'air';
    let arrivalOffset: number;
    if (scenario === 'air_only') {
      modal = 'air';
      arrivalOffset = airDays <= bd ? bd : airDays; // land at breach if we can, else ASAP
    } else if (scenario === 'sea_only') {
      modal = 'sea';
      arrivalOffset = seaArrivalForBreach(today, bd, seaDays);
    } else {
      // complete: sea if a monthly batch arrives in time, else air at/after the breach.
      const seaOff = seaArrivalForBreach(today, bd, seaDays);
      if (seaOff <= bd) {
        modal = 'sea';
        arrivalOffset = seaOff;
      } else {
        modal = 'air';
        arrivalOffset = airDays <= bd ? bd : airDays;
      }
    }
    const lead = modal === 'sea' ? seaDays : airDays;
    const ord: OpenPurchaseOrder = {
      id: `scn-${iter}`,
      vo: null,
      skuCode: stock.skuBase,
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      qty,
      orderDate: addDays(today, Math.max(0, arrivalOffset - lead)),
      eta: addDays(today, arrivalOffset),
      leadTimeDays: lead,
      modal,
      status: 'ordered',
      prepStatus: null, // a what-if arrival counts as inbound in the projection
      hubId: 'osasco',
      source: 'scenario',
      orderType: null, // suggested arrivals are the international default, never national
    };
    injected.push(ord);
    orders.push(ord);
  }
  return injected;
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
// The four scenario grids share the same weeks, criteria, and — per SKU — the same
// policy/shares/purchase meta, registered arrivals, and (crucially) the same
// base-orders-only projection: the baseline scenario IS that projection, and every
// other scenario's injection loop starts from it. A SKU that never breaches injects
// nothing, so its rows are identical across all four grids and are reused outright.

type ScopeRows = { global: WeekGridRow; byHub: Record<HubId, WeekGridRow> };

interface SkuWeekContext {
  stock: StockState;
  forecast: SkuForecast | null;
  policy: SkuPolicy;
  shares: Record<HubId, number>;
  rop: number;
  baseOrders: OpenPurchaseOrder[];
  /** Base-orders-only projection at the grid horizon — the baseline of every scenario. */
  baseProj: SkuProjections;
  regArrivals: ModalSplit;
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
  noArrivals: ModalSplit;
  noKeys: string[][];
  noNat: number[];
  contexts: SkuWeekContext[];
}

function rowsForProjection(
  ctx: SkuWeekContext,
  shared: SharedGridContext,
  proj: SkuProjections,
  sugArrivals: ModalSplit,
): ScopeRows {
  const { weeks, criteria, noArrivals, noKeys, noNat } = shared;
  const rowFor = (p: StockProjection, hasArrivals: boolean, scopeRop: number): WeekGridRow => ({
    ...ctx.meta,
    cells: sampleCells(
      p,
      weeks,
      criteria,
      scopeRop,
      hasArrivals ? ctx.regArrivals : noArrivals,
      hasArrivals ? sugArrivals : noArrivals,
      hasArrivals ? ctx.regKeys : noKeys,
      hasArrivals ? ctx.natArrivals : noNat,
    ),
  });
  const byHub = {} as Record<HubId, WeekGridRow>;
  // POs land at Osasco → only the global + Osasco streams see arrivals; spokes get 0.
  // Hub ROP is the global one pro-rated by demand share (a spoke's slice of the network
  // reorder point) for ROP-mode coloring.
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
  // Project only as far as the grid reads: the last sampled day (weekCount*7) plus the
  // 7-day forward-avg DOH window. Clamped ≥30 so dailyDemand's min(30,horizon) window —
  // and therefore every displayed number — is identical to the old 150d projections;
  // capped at HORIZON_DAYS so an out-of-range `weeks` arg reproduces today's behavior.
  const projectionHorizon = Math.min(HORIZON_DAYS, Math.max(weekCount * 7 + 7, 30));

  // Column 0 = "Hoje" (the current position — the review flagged that the grid only
  // started a week out); columns 1..N = end-of-week samples. WeekMeta.idx === array
  // index, so cell i ↔ weeks[i] everywhere.
  const weeks: WeekMeta[] = [
    { idx: 0, dayOffset: 0, endDate: today },
    ...Array.from({ length: weekCount }, (_, i) => {
      const dayOffset = (i + 1) * 7;
      return { idx: i + 1, dayOffset, endDate: addDays(today, dayOffset) };
    }),
  ];
  const noArrivals: ModalSplit = weeks.map(() => ({ sea: 0, air: 0 }));
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
    noArrivals,
    noKeys,
    noNat,
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

    // Baseline = ONLY already-registered orders; scenarios append when-needed arrivals.
    const baseOrders = inputs.ordersBySku.get(stock.skuBase) ?? [];
    const baseProj = projectSku({ stock, forecast, orders: baseOrders, policy, shares, today, horizon: projectionHorizon });

    // dailyDemand comes from the forecast only (receipts never change demand), so the
    // baseline projection's figure is identical to any scenario's.
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
      // Registered open POs feeding this SKU (same inbound rule as the projection), for
      // the left-column "N pedidos" indicator, earliest ETA first.
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
      baseOrders,
      baseProj,
      regArrivals: modalArrivalsByWeek(baseOrders, weeks, today),
      regKeys: registeredKeysByWeek(baseOrders, weeks, today),
      natArrivals: nationalArrivalsByWeek(baseOrders, weeks, today),
      meta,
      baselineRows: undefined as unknown as ScopeRows, // set right below
    };
    ctx.baselineRows = rowsForProjection(ctx, shared, baseProj, noArrivals);
    shared.contexts.push(ctx);
  }

  return shared;
}

function buildGridForScenario(shared: SharedGridContext, scenario: WeekGridScenario): WeekGrid {
  const { weekCount, criteria, dohFloor, today, weeks, projectionHorizon } = shared;
  const global: WeekGridRow[] = [];
  const byHub: Record<HubId, WeekGridRow[]> = { osasco: [], mooca: [], sbc: [] };

  for (const ctx of shared.contexts) {
    let rows = ctx.baselineRows;
    if (scenario !== 'baseline') {
      const injected = whenNeededInjection({
        scenario,
        stock: ctx.stock,
        forecast: ctx.forecast,
        policy: ctx.policy,
        baseOrders: ctx.baseOrders,
        baselineGlobal: ctx.baseProj.global,
        today,
        criteria,
        rop: ctx.rop,
        horizonDays: weekCount * 7,
        projectionHorizon,
      });
      // No injections → the scenario projection equals the baseline one; reuse the rows
      // (they're immutable after construction — each grid only sorts its own arrays).
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
        rows = rowsForProjection(ctx, shared, proj, modalArrivalsByWeek(injected, weeks, today));
      }
    }
    global.push(rows.global);
    for (const h of HUBS) byHub[h].push(rows.byHub[h]);
  }

  // Sort each scope: earliest stockout first, then by name. A row's urgency is the
  // first week it ruptures (Infinity when it never does in the window).
  const firstOutWeek = (r: WeekGridRow) => {
    const i = r.cells.findIndex((c) => c.isOut);
    return i === -1 ? Infinity : i;
  };
  const sortRows = (rows: WeekGridRow[]) =>
    rows.sort(
      (a, b) =>
        firstOutWeek(a) - firstOutWeek(b) || a.skuName.localeCompare(b.skuName, 'pt-BR'),
    );

  sortRows(global);
  for (const h of HUBS) sortRows(byHub[h]);

  return { weeks, global, byHub, scenario, dohFloor, criteria };
}

export function buildWeekGrid(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  scenario?: WeekGridScenario;
  /** Active purchase criteria → drives the "low"/breach coloring + when-needed injection. */
  criteria?: PurchaseCriteria;
}): WeekGrid {
  return buildGridForScenario(buildSharedContext(args), args.scenario ?? 'baseline');
}

/** All four coverage scenarios in one pass (shared inputs) so the client can toggle
 *  between them instantly — no per-scenario server round-trip. The scenario-invariant
 *  work (baseline projections, registered arrivals, meta, baseline rows) is computed
 *  ONCE and shared; scenarios only recompute the SKUs that actually inject orders. */
export function buildAllScenarioGrids(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  criteria?: PurchaseCriteria;
}): Record<WeekGridScenario, WeekGrid> {
  const shared = buildSharedContext(args);
  const scenarios: WeekGridScenario[] = ['baseline', 'air_only', 'sea_only', 'complete'];
  const out = {} as Record<WeekGridScenario, WeekGrid>;
  for (const scenario of scenarios) {
    out[scenario] = buildGridForScenario(shared, scenario);
  }
  return out;
}

// ─── Scope helper (shared label set with the chart components) ────────────────
export type GridScope = ProjectionScope;
