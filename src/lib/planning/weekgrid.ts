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
  INTERNATIONAL_AIR_LEAD_DAYS,
  DEFAULT_PURCHASE_CRITERIA,
  type PurchaseCriteria,
} from './constants';
import { addDays, diffDays, nextFirstOfMonth } from './dates';
import { defaultPolicyFor } from './policy';
import { forwardAvgDemand, projectSku } from './projection';

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
const DEFAULT_WEEKS = 8;
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
    const offset = diffDays(today, arrival);
    // Bucket into the week whose [end-6 .. end] window contains the arrival offset.
    const wi = weeks.findIndex((w) => offset <= w.dayOffset && offset > w.dayOffset - 7);
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
    const offset = diffDays(today, arrival);
    const wi = weeks.findIndex((w) => offset <= w.dayOffset && offset > w.dayOffset - 7);
    if (wi === -1) continue;
    const key = o.vo ?? o.id;
    if (key && !out[wi].includes(key)) out[wi].push(key);
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
  shares: Record<HubId, number>;
  baseOrders: OpenPurchaseOrder[];
  today: string;
  criteria: PurchaseCriteria;
  rop: number;
  horizonDays: number;
}): OpenPurchaseOrder[] {
  const { scenario, stock, forecast, policy, shares, baseOrders, today, criteria, rop, horizonDays } = args;
  if (scenario === 'baseline') return [];

  const seaDays = Math.max(0, Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS));
  const airDays = Math.max(0, Math.round(policy.leadTimeAirDays ?? INTERNATIONAL_AIR_LEAD_DAYS));
  const injected: OpenPurchaseOrder[] = [];
  const orders = [...baseOrders];

  for (let iter = 0; iter < MAX_INJECTIONS; iter++) {
    const proj = projectSku({ stock, forecast, orders, policy, shares, today }).global;
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
    };
    injected.push(ord);
    orders.push(ord);
  }
  return injected;
}

/** Which week column (1-based) a buy-by date falls in; null when none / beyond grid. */
function buyByWeek(buyByDate: string | null, today: string, weeks: number): number | null {
  if (!buyByDate) return null;
  const offset = diffDays(today, buyByDate);
  if (offset > weeks * 7) return null; // plenty of runway — no flag in the window
  return Math.max(1, Math.ceil(offset / 7)); // past/near → week 1
}

export function buildWeekGrid(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  scenario?: WeekGridScenario;
  /** Active purchase criteria → drives the "low"/breach coloring + when-needed injection. */
  criteria?: PurchaseCriteria;
}): WeekGrid {
  const { inputs } = args;
  const weekCount = args.weeks ?? DEFAULT_WEEKS;
  const scenario = args.scenario ?? 'baseline';
  const criteria = args.criteria ?? DEFAULT_PURCHASE_CRITERIA;
  const dohFloor = criteria.dohThreshold;
  const today = inputs.today;

  const weeks: WeekMeta[] = Array.from({ length: weekCount }, (_, i) => {
    const dayOffset = (i + 1) * 7;
    return { idx: i + 1, dayOffset, endDate: addDays(today, dayOffset) };
  });

  const purchaseBySku = new Map(args.purchases.map((p) => [p.skuBase, p]));

  const global: WeekGridRow[] = [];
  const byHub: Record<HubId, WeekGridRow[]> = { osasco: [], mooca: [], sbc: [] };

  for (const stock of inputs.stocks) {
    const forecast = inputs.forecasts.get(stock.skuBase) ?? null;
    const policy =
      inputs.policies.get(stock.skuBase) ??
      defaultPolicyFor(stock.skuBase, stock, forecast?.abcClass ?? 'C', today);
    const shares = resolveShares(stock, inputs.shares.get(stock.skuBase));
    const purchase = purchaseBySku.get(stock.skuBase);
    // Global reorder point for ROP-mode coloring/breach; hub scopes get it pro-rated by
    // their demand share (a spoke's slice of the network reorder point).
    const rop = purchase?.rop ?? 0;

    // Baseline = ONLY already-registered orders. A scenario appends "buy when needed"
    // arrivals (air/sea/complete), bounded to the visible horizon.
    const baseOrders = inputs.ordersBySku.get(stock.skuBase) ?? [];
    const injected = whenNeededInjection({
      scenario,
      stock,
      forecast,
      policy,
      shares,
      baseOrders,
      today,
      criteria,
      rop,
      horizonDays: weekCount * 7,
    });
    const orders = [...baseOrders, ...injected];

    const proj = projectSku({ stock, forecast, orders, policy, shares, today });

    const meta = {
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      leadTimeSource: policy.leadTimeSource,
      defaultModal: policy.defaultModal,
      dailyDemand: Math.round((proj.global.dailyDemand + Number.EPSILON) * 100) / 100,
      status: purchase?.status ?? 'OK',
      isLate: purchase?.isLate ?? false,
      buyByWeekIdx: buyByWeek(purchase?.buyByDate ?? null, today, weekCount),
    } as const;

    // POs land at Osasco → only the global + Osasco streams see arrivals; spokes get 0.
    // Split registered (already-placed) from suggested (scenario when-needed) so the
    // hover tooltip can label each; the inline totals are their sum.
    const regArrivals = modalArrivalsByWeek(baseOrders, weeks, today);
    const sugArrivals = modalArrivalsByWeek(injected, weeks, today);
    const regKeys = registeredKeysByWeek(baseOrders, weeks, today);
    const noArrivals = weeks.map(() => ({ sea: 0, air: 0 }));
    const noKeys: string[][] = weeks.map(() => []);
    const rowFor = (proj: StockProjection, hasArrivals: boolean, scopeRop: number): WeekGridRow => ({
      ...meta,
      cells: sampleCells(
        proj,
        weeks,
        criteria,
        scopeRop,
        hasArrivals ? regArrivals : noArrivals,
        hasArrivals ? sugArrivals : noArrivals,
        hasArrivals ? regKeys : noKeys,
      ),
    });

    global.push(rowFor(proj.global, true, rop));
    for (const h of HUBS) byHub[h].push(rowFor(proj.byHub[h], h === 'osasco', rop * (shares[h] ?? 0)));
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

/** All four coverage scenarios in one pass (shared inputs) so the client can toggle
 *  between them instantly — no per-scenario server round-trip. This is the "calculate
 *  everything and cache it" path: computed once per page load, held client-side. */
export function buildAllScenarioGrids(args: {
  inputs: WeekGridInputs;
  purchases: PurchaseSuggestion[];
  weeks?: number;
  criteria?: PurchaseCriteria;
}): Record<WeekGridScenario, WeekGrid> {
  const scenarios: WeekGridScenario[] = ['baseline', 'air_only', 'sea_only', 'complete'];
  const out = {} as Record<WeekGridScenario, WeekGrid>;
  for (const scenario of scenarios) {
    out[scenario] = buildWeekGrid({ ...args, scenario });
  }
  return out;
}

// ─── Scope helper (shared label set with the chart components) ────────────────
export type GridScope = ProjectionScope;
