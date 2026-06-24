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
import { fetchForecasts } from './source/forecast';
import { fetchOpenOrders, ordersBySkuBase } from './source/orders';
import { fetchSkuPolicies } from './source/policies';
import { fetchRecoveryRates } from './source/recovery';
import { fetchHubShares } from './source/shares';
import { fetchStockStates } from './source/stock';
import { fetchCompatModels } from './source/compat';
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
  backend: 'clickhouse' | 'metabase' | 'none';
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

  const [allStocks, forecastBundle, shares, rawOrders, alerts, compatModels, policyOverrides, recoveryRates] =
    await Promise.all([
      fetchStockStates(nowIso),
      fetchForecasts(),
      fetchHubShares(),
      fetchOpenOrders(),
      fetchSopAlerts(),
      fetchCompatModels(),
      fetchSkuPolicies(),
      fetchRecoveryRates(),
    ]);

  // Apply the app-wide filter once, here, so every downstream surface (dashboard,
  // projection, procurement, transfers) operates on the same narrowed SKU set.
  // The SKU manager + single-SKU detail views pass ignoreSkuSelection so they can
  // still list/show every SKU; all aggregate analyses respect the hand-picked set.
  const narrowFilter = ignoreSkuSelection ? { ...filter, skus: [] } : filter;
  const stocks = isFilterActive(narrowFilter)
    ? allStocks.filter((s) => skuPasses(narrowFilter, s, compatModels))
    : allStocks;

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

/** Full per-hub + global projection for one SKU (for the SKU detail + projection page). */
export async function projectOne(skuBase: string): Promise<SkuProjections | null> {
  const inp = await loadPlanningInputs();
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
