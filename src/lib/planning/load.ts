import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type {
  ElaborationSuggestion,
  HistoricalRecovery,
  HubId,
  OpenPurchaseOrder,
  PlanningAlert,
  PurchaseSuggestion,
  SkuForecast,
  SkuPolicy,
  StockState,
  TransferSuggestion,
} from '@/types/planning';
import { findElaborationTrigger, floorAtFactory, suggestModalQuantities, type OrderRules } from './elaboration';
import { DEFAULT_PURCHASE_CRITERIA, type PurchaseCriteria } from './constants';
import { activeBackendKind } from '@/lib/clickhouse/reader';
import { resolveShares } from './allocation';
import { todayUtc } from './dates';
import { applySupplierLeadTimes, buildPolicies, defaultPolicyFor, type SupplierLead } from './policy';
import { preferredSupplierBySku } from './supplierGroups';
import { projectGlobal, projectSku, type SkuProjections } from './projection';
import { purchaseForAll } from './purchase';
import { transferForAll } from './transfer';
import { fetchSopAlerts } from './source/alerts';
import { fetchForecasts, fetchForecastMeta, fetchOneForecast } from './source/forecast';
import { fetchOpenOrders, ordersBySkuBase } from './source/orders';
import { fetchSkuPolicies } from './source/policies';
import { fetchRecoveryRates } from './source/recovery';
import { fetchHubShares } from './source/shares';
import { fetchStockStates } from './source/stock';
import { fetchCompatModels } from './source/compat';
import { fetchActiveScope } from './source/scope';
import { fetchSuppliers, fetchSkuSuppliers } from './source/suppliers';
import { fetchServiceLevelZ, fetchPurchaseCriteria } from './source/globalSettings';
import type { Supplier, SkuSupplier } from '@/types';
import { SERVICE_LEVEL_Z, DEFAULT_SERVICE_LEVEL_TIER } from './constants';
import {
  EMPTY_FILTER,
  MAX_SKU_CHUNKS,
  SKU_CHUNK_PREFIX,
  decodeSkuChunks,
  type PlanningFilter,
} from './filter';

// Single per-request load of all engine inputs, then the engine runs. Wrapped in
// React `cache()` so every Server Component in one render shares one fetch+compute.

export interface PlanningInputs {
  today: string;
  asOfDate: string;
  backend: 'clickhouse' | 'none';
  /** Full catalog size BEFORE scope/filter narrowing — for the "showing N of M" notice. */
  catalogSize: number;
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  shares: Map<string, Record<HubId, number>>;
  orders: OpenPurchaseOrder[];
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  policies: Map<string, SkuPolicy>;
  alerts: PlanningAlert[];
  filter: PlanningFilter;
  /** Observed recovery rates from the IMS ledger (last 90 days). Empty when CH unavailable. */
  recoveryRates: Map<string, HistoricalRecovery>;
  /** Global service-level z (B1) applied to every SKU's safety stock. */
  serviceLevelZ: number;
  /** Bike-model compatibility (sku_base → set of model keys) — exposed so the SKUs
   *  page can build its local Modelos filter without a second fetch. */
  compatModels: Map<string, Set<string>>;
}

function emptyInputs(today: string): PlanningInputs {
  return {
    today,
    asOfDate: today,
    backend: 'none',
    catalogSize: 0,
    stocks: [],
    forecasts: new Map(),
    shares: new Map(),
    orders: [],
    ordersBySku: new Map(),
    policies: new Map(),
    alerts: [],
    filter: EMPTY_FILTER,
    recoveryRates: new Map(),
    serviceLevelZ: SERVICE_LEVEL_Z[DEFAULT_SERVICE_LEVEL_TIER],
    compatModels: new Map(),
  };
}

/** The hand-picked selection, read from the chunked `vg:skus*` cookies (it can be large
 *  → chunked across cookies to beat the ~4KB single-cookie limit). */
function readSkuChunkCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): string[] {
  return decodeSkuChunks(
    Array.from({ length: MAX_SKU_CHUNKS }, (_, i) => cookieStore.get(`${SKU_CHUNK_PREFIX}${i}`)?.value),
  );
}

/** sku_base → the preferred supplier's lead + kind, for applySupplierLeadTimes. */
function supplierLeadBySku(suppliers: Supplier[], links: SkuSupplier[]): Map<string, SupplierLead> {
  const byId = new Map(suppliers.map((s) => [s.supplierId, s]));
  const prefBySku = preferredSupplierBySku(links);
  const out = new Map<string, SupplierLead>();
  for (const [sku, supplierId] of prefBySku) {
    const s = byId.get(supplierId);
    if (!s) continue;
    out.set(sku, { kind: s.kind, sea: s.leadTimeSeaDays, air: s.leadTimeAirDays });
  }
  return out;
}

export const loadPlanningInputs = cache(async (ignoreSkuSelection = false, ignoreFilter = false): Promise<PlanningInputs> => {
  const today = todayUtc();
  const nowIso = new Date().toISOString();
  const cookieStore = await cookies();
  const filter: PlanningFilter = { skus: readSkuChunkCookies(cookieStore) };

  // No warehouse credentials configured → render the shell with empty states
  // instead of throwing (keeps the app building + usable before secrets are set).
  if (activeBackendKind() === 'none') return { ...emptyInputs(today), filter };

  const [allStocks, forecastBundle, shares, rawOrders, alerts, compatModels, policyOverrides, recoveryRates, scopeSet, serviceLevelZ, suppliers, skuSuppliers] =
    await Promise.all([
      fetchStockStates(nowIso),
      fetchForecasts(),
      fetchHubShares(),
      fetchOpenOrders(),
      fetchSopAlerts(),
      fetchCompatModels(),
      fetchSkuPolicies(),
      fetchRecoveryRates(),
      fetchActiveScope(),
      fetchServiceLevelZ(),
      fetchSuppliers(),
      fetchSkuSuppliers(),
    ]);

  // Default SKU-universe scope (sub-project A): narrow to the active-scope set
  // BEFORE the user's ad-hoc cookie filter, so every analysis defaults to the
  // reference universe. ignoreSkuSelection bypasses it (the "Lista completa" tab
  // and single-SKU deep links must still see every SKU). Fail-open: an empty
  // scope set means "no scope defined" → show all (never hide the whole catalog).
  let scopedStocks = allStocks;
  if (!ignoreSkuSelection && scopeSet.size > 0) {
    const narrowed = allStocks.filter((s) => scopeSet.has(s.skuBase));
    // Fail-open: a scope that matches NOTHING (stale or format-mismatched sku_bases)
    // must not silently hide the whole catalog — fall back to all stocks. Only narrow
    // when the scope actually selects something.
    if (narrowed.length > 0) scopedStocks = narrowed;
  }

  // Which SKUs the analyses see. Two modes (the old top-bar filter narrowing was
  // removed — filtering lives on the SKUs page and materializes into the selection):
  //   • ignoreFilter → the full catalog (SKUs page: every SKU always listed).
  //   • a hand-picked selection is present → EXACTLY that selection, from the full
  //     catalog, OVERRIDING the default scope. The SKUs-page checkbox is the single
  //     "visible to the analyses" control: checked ⟺ visible.
  //   • otherwise → the default scope.
  let stocks: StockState[];
  if (ignoreFilter) {
    stocks = allStocks;
  } else if (!ignoreSkuSelection && filter.skus.length > 0) {
    const sel = new Set(filter.skus);
    stocks = allStocks.filter((s) => sel.has(s.skuBase));
  } else {
    stocks = scopedStocks;
  }

  // (The global what-if scenario — demand ±% / delay-all-POs — was removed; order
  // timing is controlled by each pedido's editable ETA.)
  const forecasts = forecastBundle.bySku;
  const orders = rawOrders;

  // Lead time now lives on the supplier: override each SKU's lead from its preferred
  // supplier (fallback = the SKU's own policy lead when it has no supplier).
  const policies = applySupplierLeadTimes(
    buildPolicies({ stocks, forecasts, overrides: policyOverrides, nowIso }),
    supplierLeadBySku(suppliers, skuSuppliers),
  );

  return {
    today,
    asOfDate: forecastBundle.asOfDate || today,
    backend: activeBackendKind(),
    catalogSize: allStocks.length,
    stocks,
    forecasts,
    shares,
    orders,
    ordersBySku: ordersBySkuBase(orders),
    policies,
    alerts,
    filter,
    recoveryRates,
    serviceLevelZ,
    compatModels,
  };
});

export interface PlanningSnapshot extends PlanningInputs {
  purchases: PurchaseSuggestion[];
}

// NOTE on React cache(): it memoizes on the ACTUAL argument list, so f() and
// f(false, false) are different entries. Every internal caller passes both params
// explicitly so computeSnapshot and computeTransfers share ONE loadPlanningInputs
// fetch per render.
export const computeSnapshot = cache(async (ignoreSkuSelection = false, ignoreFilter = false): Promise<PlanningSnapshot> => {
  const inp = await loadPlanningInputs(ignoreSkuSelection, ignoreFilter);

  const purchases = purchaseForAll({
    stocks: inp.stocks,
    forecasts: inp.forecasts,
    policies: inp.policies,
    ordersBySku: inp.ordersBySku,
    defaultPolicy: (skuBase, stock) =>
      defaultPolicyFor(skuBase, stock, inp.forecasts.get(skuBase)?.abcClass ?? 'C', inp.today),
    today: inp.today,
    serviceLevelZ: inp.serviceLevelZ,
  });

  return { ...inp, purchases };
});

/** Transfer suggestions, split out of computeSnapshot: only the dashboard and the
 *  Transferências page read them — Semanas/Compras/SKUs/lead-times were paying for
 *  transferForAll on every load without using it. Shares loadPlanningInputs (React
 *  cache) with computeSnapshot in the same render. */
export const computeTransfers = cache(
  async (ignoreSkuSelection = false, ignoreFilter = false): Promise<TransferSuggestion[]> => {
    const inp = await loadPlanningInputs(ignoreSkuSelection, ignoreFilter);
    return transferForAll({
      stocks: inp.stocks,
      forecasts: inp.forecasts,
      sharesBySku: inp.shares,
      resolveShares: (stock) => resolveShares(stock, inp.shares.get(stock.skuBase)),
      today: inp.today,
      asOfDate: inp.asOfDate,
    });
  },
);

/** computeTransfers that never throws — [] + console error on failure. */
export async function safeComputeTransfers(
  ignoreSkuSelection = false,
  ignoreFilter = false,
): Promise<TransferSuggestion[]> {
  try {
    return await computeTransfers(ignoreSkuSelection, ignoreFilter);
  } catch (e) {
    console.error('[safeComputeTransfers]', e instanceof Error ? e.message : e);
    return [];
  }
}

/** computeSnapshot that never throws — returns empty + an error note on failure,
 *  so pages can render the shell + a banner instead of crashing. */
export async function safeComputeSnapshot(
  ignoreSkuSelection = false,
  ignoreFilter = false,
): Promise<PlanningSnapshot & { error?: string }> {
  try {
    return await computeSnapshot(ignoreSkuSelection, ignoreFilter);
  } catch (e) {
    console.error('[safeComputeSnapshot]', e instanceof Error ? e.message : e);
    const today = todayUtc();
    return {
      ...emptyInputs(today),
      backend: activeBackendKind(),
      purchases: [],
      error: e instanceof Error ? e.message : 'erro ao carregar dados',
    };
  }
}

// ─── Elaboration rows for the Compras page (sub-project B7) ───────────────────

export interface ElaborationRow {
  suggestion: ElaborationSuggestion;
  /** Default order quantity for the recommended modal (editable before confirm). */
  suggestedQty: number;
  /** Combined-plan quantities: air bridges until the monthly sea order lands (0 when no
   *  air is needed); sea is the sustaining bulk. The builder uses the one matching the
   *  chosen order modal. */
  suggestedQtyAir: number;
  suggestedQtySea: number;
  unitPrice: number | null;
  estCost: number | null;
  /** A non-cancelled order (placed or draft) already exists for this SKU. */
  hasOpenOrder: boolean;
  isNational: boolean;
  category: string | null;
}

export interface ElaborationResult {
  rows: ElaborationRow[];
  today: string;
  asOfDate: string;
  backend: 'clickhouse' | 'none';
  /** In-scope SKU universe analysed, and the full catalog size — for the scope notice. */
  skuCount: number;
  catalogSize: number;
  /** The global Admin criteria in effect (defaults for the per-pedido rules panel). */
  criteria: PurchaseCriteria;
  /** Per-pedido rule overrides applied to THIS computation (7b), when any. */
  rules?: OrderRules;
  error?: string;
}

/**
 * Compute the elaboration-trigger list for the Compras "Novo Pedido" builder. PURE
 * computation from the snapshot — projects each in-scope SKU, runs findElaborationTrigger,
 * and pairs each with a default quantity. Writes NOTHING; the user selects SKUs and
 * clicks "Criar pedido" (createPedido). Never throws (returns empty + error note).
 */
export async function computeElaborations(
  ignoreSkuSelection = false,
  /** Per-pedido rule overrides (7b) — merged over the global Admin criteria for THIS
   *  computation only; the heatmap keeps the global. */
  rules?: OrderRules,
): Promise<ElaborationResult> {
  try {
    const [inp, criteria] = await Promise.all([
      // Both args explicit — cache() keys on the argument list (see computeSnapshot).
      computeSnapshot(ignoreSkuSelection, false),
      fetchPurchaseCriteria(),
    ]);
    const purchaseBySku = new Map(inp.purchases.map((p) => [p.skuBase, p]));

    // Effective floor + time-varying air floor from the per-pedido rules.
    const effectiveFloor = rules?.seaFloorDoh ?? criteria.dohThreshold;
    const effectiveCriteria: PurchaseCriteria = { ...criteria, dohThreshold: effectiveFloor };
    const floorAt = rules?.airPeriods?.length
      ? floorAtFactory(effectiveFloor, rules.airPeriods)
      : undefined;

    const rows: ElaborationRow[] = [];
    for (const stock of inp.stocks) {
      const forecast = inp.forecasts.get(stock.skuBase) ?? null;
      const policy =
        inp.policies.get(stock.skuBase) ??
        defaultPolicyFor(stock.skuBase, stock, forecast?.abcClass ?? 'C', inp.today);
      // Global scope only — the trigger + quantity plan never read the per-hub streams,
      // so projecting all 4 scopes here was 4× the needed work.
      const proj = projectGlobal({
        stock,
        forecast,
        orders: inp.ordersBySku.get(stock.skuBase) ?? [],
        policy,
        today: inp.today,
      });
      const purchase = purchaseBySku.get(stock.skuBase);
      const suggestion = findElaborationTrigger({
        stock,
        projection: proj,
        policy,
        today: inp.today,
        criteria: effectiveCriteria,
        rop: purchase?.rop ?? 0,
        floorAt,
      });
      if (!suggestion.needsOrder) continue;

      // Combined air+sea plan: air bridges until the monthly sea order lands, sea sustains.
      const mq = suggestModalQuantities({
        projection: proj,
        policy,
        today: inp.today,
        dohThreshold: effectiveFloor,
        seaCadenceDays: rules?.seaCadenceDays,
        airFloorAt: floorAt,
      });
      const fallbackQty = Math.max(0, Math.ceil(proj.dailyDemand * Math.max(policy.targetDoi, 30)));
      const suggestedQtyAir = mq.airQty; // 0 = air not needed for this SKU
      const suggestedQtySea = mq.seaQty > 0 ? mq.seaQty : fallbackQty;
      // Recommended default = the qty for the modal the trigger picked (fall back if 0).
      const recommended = suggestion.suggestedModal === 'air' ? suggestedQtyAir : suggestedQtySea;
      const suggestedQty = recommended > 0 ? recommended : fallbackQty;
      const orders = inp.ordersBySku.get(stock.skuBase) ?? [];

      rows.push({
        suggestion,
        suggestedQty,
        suggestedQtyAir,
        suggestedQtySea,
        unitPrice: stock.unitPrice,
        estCost: stock.unitPrice != null ? Math.round(suggestedQty * stock.unitPrice) : null,
        hasOpenOrder: orders.some((o) => o.status !== 'cancelled'),
        isNational: policy.leadTimeSource === 'national-file',
        category: stock.category,
      });
    }

    // Most urgent first: late, then earliest breach date.
    rows.sort((a, b) => {
      if (a.suggestion.isLate !== b.suggestion.isLate) return a.suggestion.isLate ? -1 : 1;
      const da = a.suggestion.firstBreachDate ?? '9999';
      const db = b.suggestion.firstBreachDate ?? '9999';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    return {
      rows,
      today: inp.today,
      asOfDate: inp.asOfDate,
      backend: inp.backend,
      skuCount: inp.stocks.length,
      catalogSize: inp.catalogSize,
      criteria,
      rules,
    };
  } catch (e) {
    console.error('[computeElaborations]', e instanceof Error ? e.message : e);
    return {
      rows: [],
      today: todayUtc(),
      asOfDate: todayUtc(),
      backend: activeBackendKind(),
      skuCount: 0,
      catalogSize: 0,
      criteria: DEFAULT_PURCHASE_CRITERIA,
      error: e instanceof Error ? e.message : 'erro',
    };
  }
}

/** Full per-hub + global projection for one SKU (for the SKU detail + projection page).
 *  Pass `provided` to reuse inputs the caller already loaded (avoids a second full
 *  fetch+build); otherwise loads with the focus selection ignored so any deep-linked
 *  SKU resolves even when a hand-picked filter is active. */
export async function projectOne(
  skuBase: string,
  provided?: PlanningInputs,
): Promise<SkuProjections | null> {
  const inp = provided ?? (await loadPlanningInputs(true));
  const stock = inp.stocks.find((s) => s.skuBase === skuBase);
  if (!stock) return null;
  const policy =
    inp.policies.get(skuBase) ??
    defaultPolicyFor(skuBase, stock, inp.forecasts.get(skuBase)?.abcClass ?? 'C', inp.today);
  return projectSku({
    stock,
    forecast: inp.forecasts.get(skuBase) ?? null,
    orders: inp.ordersBySku.get(skuBase) ?? [],
    policy,
    shares: resolveShares(stock, inp.shares.get(skuBase)),
    today: inp.today,
  });
}

/** Projection for one SKU plus a "no recovery" baseline, so the chart can show the
 *  reconditioning uplift as a separate line. `baseline` is null when the SKU isn't
 *  repairable or has a 0% recovery rate (there'd be nothing to compare). Recovery is
 *  credited to the global + Osasco streams only. */
export async function projectOneCompare(
  skuBase: string,
  provided?: PlanningInputs,
): Promise<{ projections: SkuProjections; baseline: SkuProjections | null } | null> {
  const inp = provided ?? (await loadPlanningInputs(true));
  const stock = inp.stocks.find((s) => s.skuBase === skuBase);
  if (!stock) return null;
  const policy =
    inp.policies.get(skuBase) ??
    defaultPolicyFor(skuBase, stock, inp.forecasts.get(skuBase)?.abcClass ?? 'C', inp.today);
  const forecast = inp.forecasts.get(skuBase) ?? null;
  const orders = inp.ordersBySku.get(skuBase) ?? [];
  const shares = resolveShares(stock, inp.shares.get(skuBase));

  const projections = projectSku({ stock, forecast, orders, policy, shares, today: inp.today });
  const hasRecovery = policy.isRepairable && policy.recoveryRate > 0;
  const baseline = hasRecovery
    ? projectSku({
        stock,
        forecast,
        orders,
        policy: { ...policy, recoveryRate: 0 },
        shares,
        today: inp.today,
      })
    : null;
  return { projections, baseline };
}

/**
 * Single-SKU fast path for the Estoque (SKU deep-dive) page. It returns the SAME
 * PlanningInputs shape the page already consumes, but builds only ONE SKU's forecast
 * + policy instead of materializing the whole catalog (hundreds of SkuForecast objects
 * with ~90 points each, plus a policy per SKU) on every request. The selector still
 * lists every (scoped) SKU — that only needs the lightweight stock list, not forecasts.
 *
 * Resolves the selected SKU itself (requested → falls back to the first scoped SKU by
 * name) so the caller doesn't need the full inputs to pick a default.
 */
export const loadSkuView = cache(
  async (requestedSku?: string): Promise<{ inputs: PlanningInputs; selected: string }> => {
    const today = todayUtc();
    const nowIso = new Date().toISOString();
    const cookieStore = await cookies();
    const filter: PlanningFilter = { skus: readSkuChunkCookies(cookieStore) };

    if (activeBackendKind() === 'none') {
      return { inputs: { ...emptyInputs(today), filter }, selected: '' };
    }

    // Cheap, cross-request-cached sources only (no per-SKU heavy materialization).
    const [allStocks, shares, rawOrders, policyOverrides, recoveryRates, compatModels, fcMeta, scopeSet, serviceLevelZ, suppliers, skuSuppliers] =
      await Promise.all([
        fetchStockStates(nowIso),
        fetchHubShares(),
        fetchOpenOrders(),
        fetchSkuPolicies(),
        fetchRecoveryRates(),
        fetchCompatModels(),
        fetchForecastMeta(),
        fetchActiveScope(),
        fetchServiceLevelZ(),
        fetchSuppliers(),
        fetchSkuSuppliers(),
      ]);

    // Default SKU-universe scope (sub-project A): the selector lists only in-scope
    // SKUs by default. Fail-open when the scope is empty. A deep-linked out-of-scope
    // SKU is still resolved below (Pedidos etc. link to any SKU), it just isn't in
    // the default selector list.
    const inScope = scopeSet.size > 0 ? allStocks.filter((s) => scopeSet.has(s.skuBase)) : allStocks;

    // Selector = the default scope (the hand-picked selection is NOT applied here —
    // a single-SKU view resolves any SKU, same as ignoreSkuSelection).
    let stocks = inScope.slice().sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));

    // Honor a deep link to an out-of-scope SKU: if the requested SKU exists in the
    // full catalog but isn't in the scoped selector list, add it so it resolves +
    // renders (the view still defaults its selector to the scoped set).
    if (requestedSku && !stocks.some((s) => s.skuBase === requestedSku)) {
      const extra = allStocks.find((s) => s.skuBase === requestedSku);
      if (extra) stocks = [extra, ...stocks];
    }

    if (stocks.length === 0) {
      return {
        inputs: { ...emptyInputs(today), backend: activeBackendKind(), filter },
        selected: '',
      };
    }

    const selected =
      requestedSku && stocks.some((s) => s.skuBase === requestedSku)
        ? requestedSku
        : stocks[0].skuBase;
    const selStock = stocks.find((s) => s.skuBase === selected)!;

    // ONE forecast (one cached query), not the whole catalog.
    const forecast = await fetchOneForecast(selected);
    const selOrders = rawOrders.filter((o) => o.skuBase === selected);

    // ONE policy (buildPolicies over a single-element stock list reuses the exact logic).
    // Lead time overridden from the SKU's preferred supplier (same rule as the catalog).
    const forecasts = new Map<string, SkuForecast>();
    if (forecast) forecasts.set(selected, forecast);
    const policies = applySupplierLeadTimes(
      buildPolicies({ stocks: [selStock], forecasts, overrides: policyOverrides, nowIso }),
      supplierLeadBySku(suppliers, skuSuppliers),
    );

    const inputs: PlanningInputs = {
      today,
      asOfDate: forecast?.asOfDate || fcMeta.asOfDate || today,
      backend: activeBackendKind(),
      catalogSize: allStocks.length,
      stocks,
      forecasts,
      shares,
      orders: selOrders,
      ordersBySku: new Map([[selected, selOrders]]),
      policies,
      alerts: [],
      filter,
      recoveryRates,
      serviceLevelZ,
      compatModels,
    };
    return { inputs, selected };
  },
);
