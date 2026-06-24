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
  WeekMeta,
} from '@/types/planning';
import { resolveShares } from './allocation';
import { addDays, diffDays } from './dates';
import { defaultPolicyFor } from './policy';
import { projectSku } from './projection';

// ─────────────────────────────────────────────────────────────────────────────
// Weekly stockout grid — a VIEW of the existing 150-day projection, sampled at
// week boundaries (days 7, 14, … 56). All four scopes (global + 3 hubs) are
// computed server-side so the UI toggle is instant. Pure/deterministic: it only
// reuses projectSku(), so every cell is consistent with the SKU-detail charts.
//
// 8 weeks = 56 days, fully inside the 90-day forecast horizon → no extrapolation.
// ─────────────────────────────────────────────────────────────────────────────

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];
const DEFAULT_WEEKS = 8;
const LOW_DOH_THRESHOLD = 14;

export interface WeekGrid {
  weeks: WeekMeta[];
  global: WeekGridRow[];
  byHub: Record<HubId, WeekGridRow[]>;
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
function sampleCells(proj: StockProjection, weeks: WeekMeta[]): WeekCell[] {
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
      isLow: doh != null && doh < LOW_DOH_THRESHOLD,
    };
  });
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
}): WeekGrid {
  const { inputs } = args;
  const weekCount = args.weeks ?? DEFAULT_WEEKS;
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
    const proj = projectSku({
      stock,
      forecast,
      orders: inputs.ordersBySku.get(stock.skuBase) ?? [],
      policy,
      shares,
      today,
    });

    const purchase = purchaseBySku.get(stock.skuBase);
    const meta = {
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      leadTimeSource: policy.leadTimeSource,
      status: purchase?.status ?? 'OK',
      isLate: purchase?.isLate ?? false,
      buyByWeekIdx: buyByWeek(purchase?.buyByDate ?? null, today, weekCount),
    } as const;

    const rowFor = (proj: StockProjection): WeekGridRow => ({
      ...meta,
      cells: sampleCells(proj, weeks),
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

  return { weeks, global, byHub };
}

// ─── Scope helper (shared label set with the chart components) ────────────────
export type GridScope = ProjectionScope;
