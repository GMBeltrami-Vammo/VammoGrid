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
import { resolveShares } from './allocation';
import {
  DEFAULT_LEAD_TIME_DAYS,
  INTERNATIONAL_AIR_LEAD_DAYS,
  SERVICE_LEVEL_DOH_FLOOR,
  DEFAULT_SERVICE_LEVEL_TIER,
  type ServiceLevelTier,
} from './constants';
import { addDays, diffDays, nextFirstOfMonth } from './dates';
import { defaultPolicyFor } from './policy';
import { projectSku } from './projection';
import { scaleForecast } from './scenario';

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
  dohFloor: number;
}

interface WeekGridInputs {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  policies: Map<string, SkuPolicy>;
  shares: Map<string, Record<HubId, number>>;
  today: string;
}

/** Sample one scope's projection timeline into per-week cells. */
function sampleCells(proj: StockProjection, weeks: WeekMeta[], dohFloor: number): WeekCell[] {
  return weeks.map((w) => {
    const end = proj.timeline[w.dayOffset];
    const stock = end?.stock ?? 0;
    const demand = end?.demand ?? 0;
    // Sum inbound + recovery over the 7 days that make up this week.
    let inbound = 0;
    let recovery = 0;
    for (let d = w.dayOffset - 6; d <= w.dayOffset; d++) {
      const p = proj.timeline[d];
      if (!p) continue;
      inbound += p.inbound;
      recovery += p.recovery;
    }
    const doh = demand > 0 ? Math.round(stock / demand) : null;
    return {
      stock,
      doh,
      inbound: Math.round(inbound),
      recovery: Math.round(recovery),
      isOut: stock <= 0,
      isLow: doh != null && doh < dohFloor,
      extrapolated: w.dayOffset > MODEL_HORIZON_DAYS,
    };
  });
}

/** Build the what-if orders injected by a coverage scenario (C1). Air arrives at
 *  today + air lead; sea at the next monthly batch (1st) + sea lead. Quantity is the
 *  purchase engine's suggested orderQty (a lead-time-demand cover as fallback). */
function scenarioOrders(
  scenario: WeekGridScenario,
  stock: StockState,
  policy: SkuPolicy,
  purchase: PurchaseSuggestion | undefined,
  today: string,
): OpenPurchaseOrder[] {
  if (scenario === 'baseline') return [];
  const qty =
    purchase && purchase.orderQty > 0
      ? purchase.orderQty
      : Math.max(0, Math.round(purchase?.expectedLeadTimeDemand ?? 0));
  if (qty <= 0) return [];

  const seaDays = Math.max(0, Math.round(policy.leadTimeSeaDays ?? DEFAULT_LEAD_TIME_DAYS));
  const airDays = Math.max(0, Math.round(policy.leadTimeAirDays ?? INTERNATIONAL_AIR_LEAD_DAYS));
  const mk = (modal: 'sea' | 'air', arrival: string): OpenPurchaseOrder => ({
    id: `scn-${modal}`,
    vo: null,
    skuCode: stock.skuBase,
    skuBase: stock.skuBase,
    skuName: stock.skuName,
    qty,
    orderDate: today,
    eta: arrival,
    leadTimeDays: modal === 'sea' ? seaDays : airDays,
    modal,
    status: 'ordered',
    prepStatus: null, // a what-if arrival must count as inbound in the projection
    hubId: 'osasco',
    source: 'scenario',
  });

  const out: OpenPurchaseOrder[] = [];
  if (scenario === 'air_only' || scenario === 'complete') out.push(mk('air', addDays(today, airDays)));
  if (scenario === 'sea_only' || scenario === 'complete') {
    out.push(mk('sea', addDays(nextFirstOfMonth(today), seaDays)));
  }
  return out;
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
  /** Global service-level tier → the DOH coverage floor used for cell coloring (C2). */
  serviceLevelTier?: ServiceLevelTier;
  /** Extra demand % from reactivating backlog bikes (G2): scales every SKU's forecast
   *  up, reusing the what-if scaling. 0 = no backlog uplift. */
  demandScalePct?: number;
}): WeekGrid {
  const { inputs } = args;
  const weekCount = args.weeks ?? DEFAULT_WEEKS;
  const scenario = args.scenario ?? 'baseline';
  const tier = args.serviceLevelTier ?? DEFAULT_SERVICE_LEVEL_TIER;
  const dohFloor = SERVICE_LEVEL_DOH_FLOOR[tier];
  const demandScalePct = args.demandScalePct ?? 0;
  const today = inputs.today;

  const weeks: WeekMeta[] = Array.from({ length: weekCount }, (_, i) => {
    const dayOffset = (i + 1) * 7;
    return { idx: i + 1, dayOffset, endDate: addDays(today, dayOffset) };
  });

  const purchaseBySku = new Map(args.purchases.map((p) => [p.skuBase, p]));

  const global: WeekGridRow[] = [];
  const byHub: Record<HubId, WeekGridRow[]> = { osasco: [], mooca: [], sbc: [] };

  for (const stock of inputs.stocks) {
    const rawForecast = inputs.forecasts.get(stock.skuBase) ?? null;
    // Backlog demand uplift (G2): scale the forecast up by the reactivation %.
    const forecast =
      demandScalePct > 0 && rawForecast ? scaleForecast(rawForecast, demandScalePct) : rawForecast;
    const policy =
      inputs.policies.get(stock.skuBase) ??
      defaultPolicyFor(stock.skuBase, stock, forecast?.abcClass ?? 'C', today);
    const shares = resolveShares(stock, inputs.shares.get(stock.skuBase));
    const purchase = purchaseBySku.get(stock.skuBase);

    // Baseline = real open orders only; a scenario appends what-if air/sea arrivals.
    const baseOrders = inputs.ordersBySku.get(stock.skuBase) ?? [];
    const orders = [...baseOrders, ...scenarioOrders(scenario, stock, policy, purchase, today)];

    const proj = projectSku({ stock, forecast, orders, policy, shares, today });

    const meta = {
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      leadTimeSource: policy.leadTimeSource,
      defaultModal: policy.defaultModal,
      status: purchase?.status ?? 'OK',
      isLate: purchase?.isLate ?? false,
      buyByWeekIdx: buyByWeek(purchase?.buyByDate ?? null, today, weekCount),
    } as const;

    const rowFor = (proj: StockProjection): WeekGridRow => ({
      ...meta,
      cells: sampleCells(proj, weeks, dohFloor),
    });

    global.push(rowFor(proj.global));
    for (const h of HUBS) byHub[h].push(rowFor(proj.byHub[h]));
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

  return { weeks, global, byHub, scenario, dohFloor };
}

// ─── Scope helper (shared label set with the chart components) ────────────────
export type GridScope = ProjectionScope;
