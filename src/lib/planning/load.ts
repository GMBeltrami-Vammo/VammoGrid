import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type {
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
import { activeBackendKind } from '@/lib/clickhouse/reader';
import { resolveShares } from './allocation';
import { todayUtc } from './dates';
import { buildPolicies, defaultPolicyFor } from './policy';
import { projectSku, type SkuProjections } from './projection';
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
import { fetchServiceLevelZ } from './source/globalSettings';
import { SERVICE_LEVEL_Z, DEFAULT_SERVICE_LEVEL_TIER } from './constants';
import {
  EMPTY_FILTER,
  FILTER_COOKIE,
  isFilterActive,
  parseFilterCookie,
  skuPasses,
  type PlanningFilter,
} from './filter';
import {
  EMPTY_SCENARIO,
  SCENARIO_COOKIE,
  delayOrder,
  isScenarioActive,
  parseScenarioCookie,
  scaleForecast,
  type PlanningScenario,
} from './scenario';

// Single per-request load of all engine inputs, then the engine runs. Wrapped in
// React `cache()` so every Server Component in one render shares one fetch+compute.

export interface PlanningInputs {
  today: string;
  asOfDate: string;
  backend: 'clickhouse' | 'none';
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  shares: Map<string, Record<HubId, number>>;
  orders: OpenPurchaseOrder[];
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  policies: Map<string, SkuPolicy>;
  alerts: PlanningAlert[];
  filter: PlanningFilter;
  scenario: PlanningScenario;
  /** Observed recovery rates from the IMS ledger (last 90 days). Empty when CH unavailable. */
  recoveryRates: Map<string, HistoricalRecovery>;
  /** Global service-level z (B1) applied to every SKU's safety stock. */
  serviceLevelZ: number;
}

function emptyInputs(today: string): PlanningInputs {
  return {
    today,
    asOfDate: today,
    backend: 'none',
    stocks: [],
    forecasts: new Map(),
    shares: new Map(),
    orders: [],
    ordersBySku: new Map(),
    policies: new Map(),
    alerts: [],
    filter: EMPTY_FILTER,
    scenario: EMPTY_SCENARIO,
    recoveryRates: new Map(),
    serviceLevelZ: SERVICE_LEVEL_Z[DEFAULT_SERVICE_LEVEL_TIER],
  };
}

export const loadPlanningInputs = cache(async (ignoreSkuSelection = false): Promise<PlanningInputs> => {
  const today = todayUtc();
  const nowIso = new Date().toISOString();
  const cookieStore = await cookies();
  const filter = parseFilterCookie(cookieStore.get(FILTER_COOKIE)?.value);
  const scenario = parseScenarioCookie(cookieStore.get(SCENARIO_COOKIE)?.value);

  // No warehouse credentials configured → render the shell with empty states
  // instead of throwing (keeps the app building + usable before secrets are set).
  if (activeBackendKind() === 'none') return { ...emptyInputs(today), filter, scenario };

  const [allStocks, forecastBundle, shares, rawOrders, alerts, compatModels, policyOverrides, recoveryRates, scopeSet, serviceLevelZ] =
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
    ]);

  // Default SKU-universe scope (sub-project A): narrow to the active-scope set
  // BEFORE the user's ad-hoc cookie filter, so every analysis defaults to the
  // reference universe. ignoreSkuSelection bypasses it (the "Lista completa" tab
  // and single-SKU deep links must still see every SKU). Fail-open: an empty
  // scope set means "no scope defined" → show all (never hide the whole catalog).
  const scopedStocks =
    !ignoreSkuSelection && scopeSet.size > 0
      ? allStocks.filter((s) => scopeSet.has(s.skuBase))
      : allStocks;

  // Apply the app-wide filter once, here, so every downstream surface (dashboard,
  // projection, procurement, transfers) operates on the same narrowed SKU set.
  // The SKU manager + single-SKU detail views pass ignoreSkuSelection so they can
  // still list/show every SKU; all aggregate analyses respect the hand-picked set.
  const narrowFilter = ignoreSkuSelection ? { ...filter, skus: [] } : filter;
  const stocks = isFilterActive(narrowFilter)
    ? scopedStocks.filter(
        (s) =>
          skuPasses(narrowFilter, s, compatModels) &&
          // "Com previsão": only SKUs with a demand forecast (needs the forecast map).
          (!narrowFilter.withForecast || forecastBundle.bySku.has(s.skuBase)),
      )
    : scopedStocks;

  // Apply the what-if scenario (read-only): scale demand, delay open POs. Done here
  // so the entire app reflects the simulation without touching production data.
  const active = isScenarioActive(scenario);
  const forecasts = active
    ? new Map(
        [...forecastBundle.bySku].map(([k, fc]) => [k, scaleForecast(fc, scenario.demandPct)]),
      )
    : forecastBundle.bySku;
  const orders = active ? rawOrders.map((o) => delayOrder(o, scenario.poDelayDays)) : rawOrders;

  const policies = buildPolicies({ stocks, forecasts, overrides: policyOverrides, nowIso });

  return {
    today,
    asOfDate: forecastBundle.asOfDate || today,
    backend: activeBackendKind(),
    stocks,
    forecasts,
    shares,
    orders,
    ordersBySku: ordersBySkuBase(orders),
    policies,
    alerts,
    filter,
    scenario,
    recoveryRates,
    serviceLevelZ,
  };
});

export interface PlanningSnapshot extends PlanningInputs {
  purchases: PurchaseSuggestion[];
  transfers: TransferSuggestion[];
}

export const computeSnapshot = cache(async (ignoreSkuSelection = false): Promise<PlanningSnapshot> => {
  const inp = await loadPlanningInputs(ignoreSkuSelection);

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

  const transfers = transferForAll({
    stocks: inp.stocks,
    forecasts: inp.forecasts,
    sharesBySku: inp.shares,
    resolveShares: (stock) => resolveShares(stock, inp.shares.get(stock.skuBase)),
    today: inp.today,
    asOfDate: inp.asOfDate,
  });

  return { ...inp, purchases, transfers };
});

/** computeSnapshot that never throws — returns empty + an error note on failure,
 *  so pages can render the shell + a banner instead of crashing. */
export async function safeComputeSnapshot(
  ignoreSkuSelection = false,
): Promise<PlanningSnapshot & { error?: string }> {
  try {
    return await computeSnapshot(ignoreSkuSelection);
  } catch (e) {
    console.error('[safeComputeSnapshot]', e instanceof Error ? e.message : e);
    const today = todayUtc();
    return {
      ...emptyInputs(today),
      backend: activeBackendKind(),
      purchases: [],
      transfers: [],
      error: e instanceof Error ? e.message : 'erro ao carregar dados',
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
    const filter = parseFilterCookie(cookieStore.get(FILTER_COOKIE)?.value);
    const scenario = parseScenarioCookie(cookieStore.get(SCENARIO_COOKIE)?.value);

    if (activeBackendKind() === 'none') {
      return { inputs: { ...emptyInputs(today), filter, scenario }, selected: '' };
    }

    // Cheap, cross-request-cached sources only (no per-SKU heavy materialization).
    const [allStocks, shares, rawOrders, policyOverrides, recoveryRates, compatModels, fcMeta, scopeSet, serviceLevelZ] =
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
      ]);

    // Default SKU-universe scope (sub-project A): the selector lists only in-scope
    // SKUs by default. Fail-open when the scope is empty. A deep-linked out-of-scope
    // SKU is still resolved below (Pedidos etc. link to any SKU), it just isn't in
    // the default selector list.
    const inScope = scopeSet.size > 0 ? allStocks.filter((s) => scopeSet.has(s.skuBase)) : allStocks;

    // Selector scope honors category/models/q + "com previsão", but NOT the hand-picked
    // skus[] (a single-SKU view resolves any SKU — same as ignoreSkuSelection).
    const scopeFilter: PlanningFilter = { ...filter, skus: [] };
    const scoped = isFilterActive(scopeFilter)
      ? inScope.filter(
          (s) =>
            skuPasses(scopeFilter, s, compatModels) &&
            (!scopeFilter.withForecast || fcMeta.skuBases.has(s.skuBase)),
        )
      : inScope;
    let stocks = (scoped.length > 0 ? scoped : inScope)
      .slice()
      .sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));

    // Honor a deep link to an out-of-scope SKU: if the requested SKU exists in the
    // full catalog but isn't in the scoped selector list, add it so it resolves +
    // renders (the view still defaults its selector to the scoped set).
    if (requestedSku && !stocks.some((s) => s.skuBase === requestedSku)) {
      const extra = allStocks.find((s) => s.skuBase === requestedSku);
      if (extra) stocks = [extra, ...stocks];
    }

    if (stocks.length === 0) {
      return {
        inputs: { ...emptyInputs(today), backend: activeBackendKind(), filter, scenario },
        selected: '',
      };
    }

    const selected =
      requestedSku && stocks.some((s) => s.skuBase === requestedSku)
        ? requestedSku
        : stocks[0].skuBase;
    const selStock = stocks.find((s) => s.skuBase === selected)!;

    // ONE forecast (one cached query), not the whole catalog. Apply the what-if only
    // when active (same gate as loadPlanningInputs).
    const rawForecast = await fetchOneForecast(selected);
    const active = isScenarioActive(scenario);
    const forecast = active && rawForecast ? scaleForecast(rawForecast, scenario.demandPct) : rawForecast;

    const selOrders0 = rawOrders.filter((o) => o.skuBase === selected);
    const selOrders = active ? selOrders0.map((o) => delayOrder(o, scenario.poDelayDays)) : selOrders0;

    // ONE policy (buildPolicies over a single-element stock list reuses the exact logic).
    const forecasts = new Map<string, SkuForecast>();
    if (forecast) forecasts.set(selected, forecast);
    const policies = buildPolicies({ stocks: [selStock], forecasts, overrides: policyOverrides, nowIso });

    const inputs: PlanningInputs = {
      today,
      asOfDate: forecast?.asOfDate || fcMeta.asOfDate || today,
      backend: activeBackendKind(),
      stocks,
      forecasts,
      shares,
      orders: selOrders,
      ordersBySku: new Map([[selected, selOrders]]),
      policies,
      alerts: [],
      filter,
      scenario,
      recoveryRates,
      serviceLevelZ,
    };
    return { inputs, selected };
  },
);
