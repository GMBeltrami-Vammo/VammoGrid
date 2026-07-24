import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { loadSkuView, projectOneCompare } from '@/lib/planning/load';
import { computeArrivals, projectSku, type SkuProjections } from '@/lib/planning/projection';
import { suggestModalQuantities, type ModalPlan } from '@/lib/planning/elaboration';
import { suggestCascadeQuantities, type MiniProjSeed } from '@/lib/planning/miniStrip';
import { modalsForSupplier } from '@/lib/planning/supplierGroups';
import { MODAL_CFG_COOKIE, parseModalCfg } from '@/lib/planning/modalConfig';
import { HORIZON_DAYS } from '@/lib/planning/constants';
import { buildDailyDemand } from '@/lib/planning/forecast';
import { purchaseForSku } from '@/lib/planning/purchase';
import { fetchStockHistory } from '@/lib/planning/source/history';
import { fetchHubMaxStock } from '@/lib/planning/source/hubMaxStock';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchRecoveryRefreshedAt } from '@/lib/planning/recoveryRefresh';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { fetchFleetWeeklySizes } from '@/lib/planning/source/fleetSizeWeekly';
import { fetchDailyConsumption } from '@/lib/planning/source/consumption';
import { netMonthlyGrowthRate } from '@/lib/planning/fleetGrowth';
import {
  buildCompatFleetSeries,
  buildNaiveForecast,
  consumptionByDate,
  fleetAccessor,
  naiveRate,
  pickCompatFleet,
  type FleetSegmentInput,
} from '@/lib/planning/naiveEngines';
import { addDays } from '@/lib/planning/dates';
import type { OpenPurchaseOrder } from '@/types/planning';
import { HubMaxStockPanel } from '@/components/planning/HubMaxStockPanel';
import { resolveShares } from '@/lib/planning/allocation';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { HUB_LIST } from '@/constants/planningHubs';
import { fmtDate, fmtInt, fmtNum } from '@/lib/planning/format';
import {
  EmptyState,
  FreshnessBanner,
  KpiCard,
  LatePill,
  PageHeader,
  SectionTitle,
  StatusPill,
} from '@/components/planning/ui';
import { InfoHint } from '@/components/planning/InfoHint';
import { EstoqueView } from '@/components/planning/EstoqueView';
import { ForecastSourceBadge } from '@/components/planning/ForecastSourceBadge';
import { SkuSuggestionControls } from '@/components/planning/SkuSuggestionControls';
import { RecoveryPanel } from '@/components/planning/RecoveryPanel';
import { LeadTimePanel } from '@/components/planning/LeadTimePanel';
import { SupplierLinksPanel } from '@/components/suppliers/SupplierLinksPanel';
import { SafetyStockPanel } from '@/components/planning/SafetyStockPanel';
import { SkuSimulator } from '@/components/planning/SkuSimulator';
import { SkuFilterToggle } from '@/components/planning/SkuFilterToggle';

export const dynamic = 'force-dynamic';

// Unified single-SKU view: the SKU selector + dual charts (D-30→D+30 and D0→D+150)
// plus the full deep-dive (per-hub stock, purchase recommendation, safety stock,
// recovery, simulator, open orders). This is the canonical SKU page; /dashboard/sku/[sku]
// redirects here.
export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string; forn?: string; modais?: string }>;
}) {
  const sp = await searchParams;
  // Single-SKU fast path: builds only the selected SKU's forecast + policy (not the
  // whole catalog). It resolves the selection and lists the scoped catalog for the
  // selector. Deep-links resolve any SKU; the hand-picked focus set is ignored here.
  const { inputs, selected } = await loadSkuView(sp.sku);

  if (inputs.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Estoque" title="Estoque" />
        <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para visualizar o estoque." />
      </div>
    );
  }

  // inputs.stocks is already the scoped catalog, sorted by name, and `selected` is
  // already resolved by loadSkuView.
  const options = inputs.stocks.map((s) => ({ skuBase: s.skuBase, skuName: s.skuName }));

  const selStock = inputs.stocks.find((s) => s.skuBase === selected)!;
  const forecast = inputs.forecasts.get(selected) ?? null;
  const orders = inputs.ordersBySku.get(selected) ?? [];
  const policy =
    inputs.policies.get(selected) ??
    defaultPolicyFor(selected, selStock, forecast?.abcClass ?? 'C', inputs.today);
  const shares = resolveShares(selStock, inputs.shares.get(selected));

  // Feature C: L30/L90 naive-engine comparison needs 90d of real consumption + the fleet
  // control points (compat-aware divisor). Single SKU, fetched alongside the rest.
  const from90 = addDays(inputs.today, -90);

  const [compare, history, recoveryRefreshedAt, hubMaxStock, criteria, suppliers, skuSuppliers, supplierModals, fleetRows, weeklyRows, consumptionRows, cookieStore, session] = await Promise.all([
    projectOneCompare(selected, inputs), // reuse inputs — avoids a 2nd full load
    fetchStockHistory(selStock.skuBase, selStock.byHub, 30),
    fetchRecoveryRefreshedAt(),
    fetchHubMaxStock(),
    fetchPurchaseCriteria(),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchSupplierModals(),
    fetchFleetInfoRows(),
    fetchFleetWeeklySizes(),
    fetchDailyConsumption(selStock.skuBase, from90, inputs.today),
    cookies(),
    auth(),
  ]);
  const skuLinks = skuSuppliers.filter((l) => l.skuBase === selected);
  // Preferred supplier drives the SKU's (read-only) lead time — see applySupplierLeadTimes.
  const preferredLink = skuLinks.find((l) => l.isPreferred) ?? [...skuLinks].sort((a, b) => a.priority - b.priority)[0];
  const leadSupplierName = preferredLink
    ? suppliers.find((s) => s.supplierId === preferredLink.supplierId)?.name ?? null
    : null;
  const isHead = session?.user?.isHead ?? false;
  const projections = compare?.projections ?? null;
  const baseline = compare?.baseline ?? null;
  const arrivals = computeArrivals(orders, inputs.today);

  // ── L30/L90 naive comparison engines (Feature C) — faded reference lines, COMPARISON
  //    ONLY (never feed ordering/elaboration/cascade/decision DOH). Built here, per-SKU,
  //    lazily: a naive per-bike rate over the last 30/90 days × the compat-aware projected
  //    fleet → a synthetic forecast re-projected with the SAME orders/policy so the line is
  //    point-to-point comparable. See lib/planning/naiveEngines.ts + decisions.MD #35.
  const naiveComparisons: { label: string; color: string; projections: SkuProjections }[] = [];
  if (projections) {
    const to = addDays(inputs.today, HORIZON_DAYS);
    const fleetSegments: FleetSegmentInput[] = fleetRows.map((r) => {
      const cps = weeklyRows
        .filter((w) => w.segment === r.segment)
        .map((w) => ({ date: String(w.week_start).slice(0, 10), size: Number(w.size) || 0 }));
      if (cps.length === 0) {
        cps.push({ date: String(r.as_of_date ?? inputs.today).slice(0, 10), size: Number(r.current_size) || 0 });
      }
      return {
        segment: r.segment,
        controlPoints: cps,
        monthlyGrowthRate: netMonthlyGrowthRate({
          monthlyGrowthRate: Number(r.monthly_growth_rate) || 0,
          commercialTargetPct: r.commercial_target_pct ?? null,
          churnPct: r.churn_pct ?? null,
        }),
      };
    });
    const fleetSeries = buildCompatFleetSeries({ segments: fleetSegments, from: from90, to });
    const compatSeries = pickCompatFleet(inputs.compatModels.get(selected), fleetSeries);
    const fleetOn = fleetAccessor(compatSeries, from90);
    const consumption = consumptionByDate(consumptionRows);
    const naiveDefs = [
      { window: 30 as const, label: 'L30', color: '#7c3aed' },
      { window: 90 as const, label: 'L90', color: '#0d9488' },
    ];
    for (const d of naiveDefs) {
      const rate = naiveRate({ consumption, fleetOn, today: inputs.today, windowDays: d.window });
      if (rate <= 0) continue; // no consumption signal → no comparison line
      const naiveFc = buildNaiveForecast({
        skuBase: selected,
        window: d.window,
        rate,
        fleetOn,
        today: inputs.today,
        horizonDays: HORIZON_DAYS,
      });
      const proj = projectSku({ stock: selStock, forecast: naiveFc, orders, policy, shares, today: inputs.today });
      naiveComparisons.push({ label: d.label, color: d.color, projections: proj });
    }
  }

  // ── Interactive suggested-order simulation (the yellow overlay), driven by a supplier + modal
  //    panel LOCKED to the suppliers that carry THIS SKU. Supplier + enabled modais come from the
  //    URL (?forn/?modais → server recompute); piso/cadência/lead from the shared vg:modalcfg cookie.
  const cfg = parseModalCfg(cookieStore.get(MODAL_CFG_COOKIE)?.value);
  const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
  const linkedSupplierIds = [...new Set(skuLinks.map((l) => l.supplierId))].filter((id) => supplierById.has(id));
  const lockedSuppliers = linkedSupplierIds.map((id) => ({ supplierId: id, name: supplierById.get(id)!.name }));
  const selectedSupplierId =
    (sp.forn && linkedSupplierIds.includes(sp.forn) ? sp.forn : '') ||
    (preferredLink && linkedSupplierIds.includes(preferredLink.supplierId) ? preferredLink.supplierId : '') ||
    linkedSupplierIds[0] ||
    '';
  const selModais = selectedSupplierId ? modalsForSupplier(supplierById.get(selectedSupplierId) ?? null, supplierModals) : [];
  const selNames = selModais.map((m) => m.name);
  const enabledModais =
    sp.modais === undefined ? selNames : sp.modais.split(',').map((s) => s.trim()).filter((n) => selNames.includes(n));

  // Synthetic suggested order (the engine ignores modal; timing = eta). modal is coarse
  // 'sea'/'air' by arrival (only to satisfy the type — not shown on the overlay line).
  const mkSugOrder = (key: string, qty: number, arrivalOffset: number): OpenPurchaseOrder => {
    const off = Math.max(0, Math.round(arrivalOffset));
    return {
      id: `sug-${key}`, vo: null, skuCode: selected, skuBase: selected, skuName: selStock.skuName,
      qty, orderDate: inputs.today, eta: addDays(inputs.today, off), leadTimeDays: off,
      modal: off >= 30 ? 'sea' : 'air', status: 'ordered', prepStatus: null, hubId: 'osasco', source: 'scenario', orderType: null,
    };
  };

  // Yellow "com pedido sugerido" overlay: the N-modal cascade for the selected supplier's enabled
  // modais (sim lead/piso/cadência from the cookie). Falls back to the SKU's policy 2-modal plan
  // only when NO supplier/modais are registered (so unlinked SKUs still show a line); unchecking
  // every modal of a linked supplier turns the overlay OFF.
  let suggestion: SkuProjections | null = null;
  if (projections) {
    const sugOrders: OpenPurchaseOrder[] = [];
    const enabledOpts = selModais.filter((m) => enabledModais.includes(m.name));
    if (selModais.length > 0 && enabledOpts.length > 0) {
      const H = HORIZON_DAYS;
      const fleet = buildDailyDemand(forecast, H);
      const receipts: Record<number, number> = {};
      for (const p of projections.global.timeline) if (p.day <= H && p.inbound > 0) receipts[p.day] = p.inbound;
      const seed: MiniProjSeed = {
        startStock: selStock.total,
        demandYhat: fleet.yhat,
        modelHorizon: forecast?.horizonDays ?? H,
        receipts,
        recoveryRate: policy.recoveryRate,
        recoveryTurnaround: policy.recoveryTurnaroundDays,
        isRepairable: policy.isRepairable,
        horizon: H,
      };
      const cfgSup = cfg[selectedSupplierId] ?? {};
      const slowId = [...enabledOpts]
        .sort((a, b) => (cfgSup[a.name]?.lead ?? a.leadDays) - (cfgSup[b.name]?.lead ?? b.leadDays))
        .at(-1)?.id;
      const plans: ModalPlan[] = enabledOpts.map((m) => {
        const e = cfgSup[m.name] ?? {};
        const lead = e.lead && e.lead > 0 ? e.lead : m.leadDays;
        return {
          modal: { ...m, leadDays: lead }, // sim lead — planning only
          minDoh: e.piso && e.piso > 0 ? e.piso : criteria.dohThreshold,
          cadenceDays: m.id === slowId ? (e.cad && e.cad > 0 ? e.cad : 30) : 0,
          enabled: true,
        };
      });
      for (const q of suggestCascadeQuantities({ seed, plans, today: inputs.today })) {
        if (q.qty > 0) sugOrders.push(mkSugOrder(q.modalName, q.qty, q.arrivalOffset));
      }
    } else if (selModais.length === 0) {
      // No supplier linked (or the supplier has no modais registered) → policy air/sea fallback,
      // so the overlay never vanishes for unlinked SKUs. NOTE: a supplier WITH modais whose boxes
      // are all unchecked falls through to neither branch → no overlay (the user turned it off).
      const mq = suggestModalQuantities({ projection: projections.global, policy, today: inputs.today, dohThreshold: criteria.dohThreshold });
      if (mq.airQty > 0) sugOrders.push(mkSugOrder('air', mq.airQty, mq.airArrival));
      if (mq.seaQty > 0) sugOrders.push(mkSugOrder('sea', mq.seaQty, mq.seaArrival));
    }
    if (sugOrders.length > 0) {
      suggestion = projectSku({ stock: selStock, forecast, orders: [...orders, ...sugOrders], policy, shares, today: inputs.today });
    }
  }
  const purchase = purchaseForSku({
    skuBase: selected,
    skuName: selStock.skuName,
    forecast,
    stock: selStock,
    orders,
    policy,
    today: inputs.today,
    serviceLevelZ: inputs.serviceLevelZ,
  });

  const leadLabel =
    policy.leadTimeSource === 'national-file'
      ? 'nacional'
      : policy.leadTimeSource === 'manual'
        ? 'manual'
        : 'internacional';

  return (
    <div>
      <div className="mb-1 flex items-center justify-end">
        <SkuFilterToggle skuBase={selected} filter={inputs.filter} />
      </div>
      <PageHeader
        eyebrow={`${selected} · classe ${policy.abcClass} · lead ${policy.leadTimeDays}d (${leadLabel})`}
        title={selStock.skuName}
        subtitle={selStock.isRepairable ? 'Peça recuperável (reconditioning)' : 'Peça não recuperável'}
      />
      {forecast?.source && (
        <div className="mb-2 -mt-1">
          <ForecastSourceBadge
            source={forecast.source}
            asOfDate={forecast.asOfDate}
            modelVersion={forecast.modelVersion}
          />
        </div>
      )}
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      {/* Pedido sugerido (simulação) — fornecedor + modais deste SKU alimentam a linha amarela */}
      <div className="mb-4">
        <SkuSuggestionControls
          suppliers={lockedSuppliers}
          selectedSupplierId={selectedSupplierId}
          modais={selModais}
          enabledModais={enabledModais}
          dohThreshold={criteria.dohThreshold}
        />
      </div>

      {/* SKU selector + scope toggle + D-30→D+30 and D0→D+150 charts */}
      <EstoqueView
        options={options}
        selected={selected}
        projections={projections}
        baseline={baseline}
        suggestion={suggestion}
        comparisons={naiveComparisons}
        arrivals={arrivals}
        history={history}
      />

      {projections && (
        <>
          {/* Per-hub stock */}
          <div className="mt-8">
            <SectionTitle>Estoque por hub</SectionTitle>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label={<span className="inline-flex items-center gap-1">Total <InfoHint id="onhand" /></span>}
                value={fmtInt(selStock.total)}
                tone="brand"
              />
              {HUB_LIST.map((h) => (
                <KpiCard
                  key={h.id}
                  label={h.name}
                  value={fmtInt(selStock.byHub[h.id])}
                  hint={
                    projections.byHub[h.id].stockoutDate
                      ? `ruptura ${fmtDate(projections.byHub[h.id].stockoutDate)}`
                      : 'sem ruptura'
                  }
                  tone={projections.byHub[h.id].stockoutDate ? 'danger' : 'default'}
                />
              ))}
            </div>
            <HubMaxStockPanel
              skuBase={selStock.skuBase}
              byHub={selStock.byHub}
              caps={hubMaxStock.get(selStock.skuBase) ?? {}}
              isHead={isHead}
            />
          </div>

          {/* Purchase recommendation */}
          <SectionTitle>Recomendação de compra</SectionTitle>
          <div className="mb-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="mb-3 flex items-center gap-2">
              <StatusPill status={purchase.status} />
              {purchase.isLate && <LatePill />}
              <span className="text-sm text-muted-foreground">{purchase.reasoning}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Metric
                label={<span className="inline-flex items-center gap-1">Ponto recompra <InfoHint id="rop" /></span>}
                value={fmtInt(purchase.rop)}
                sub={purchase.ropDoh != null ? `${fmtInt(purchase.ropDoh)} DOH` : undefined}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Estoque segurança <InfoHint id="safety" /></span>}
                value={fmtInt(purchase.safetyStock)}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Estoque mínimo <InfoHint id="estoque-minimo" /></span>}
                value={fmtInt(purchase.expectedLeadTimeDemand)}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Comprar (qtd) <InfoHint id="order-qty" /></span>}
                value={purchase.orderQty > 0 ? fmtInt(purchase.orderQty) : '—'}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Comprar até <InfoHint id="buy-by" /></span>}
                value={fmtDate(purchase.buyByDate)}
              />
            </div>
          </div>

          {/* Lead time — read-only; comes from the preferred supplier (edited em Fornecedores) */}
          <SectionTitle>Lead time</SectionTitle>
          <div className="mb-6">
            <LeadTimePanel
              seaDays={Math.round(policy.leadTimeSeaDays ?? policy.leadTimeDays)}
              airDays={Math.round(policy.leadTimeAirDays ?? policy.leadTimeDays)}
              defaultModal={policy.defaultModal}
              supplierName={leadSupplierName}
            />
          </div>

          {/* Fornecedores do SKU (review 4b) — vínculo + preferido */}
          <SectionTitle>Fornecedores</SectionTitle>
          <div className="mb-6">
            <SupplierLinksPanel skuBase={selected} allSuppliers={suppliers} links={skuLinks} isHead={isHead} />
          </div>

          {/* Safety stock (global) — editable, feeds the purchase suggestion */}
          <SectionTitle>Estoque de segurança (global)</SectionTitle>
          <div className="mb-6">
            <SafetyStockPanel
              skuBase={selected}
              abcClass={policy.abcClass}
              sigmaMonthly={purchase.sigmaMonthly}
              sigmaL={purchase.sigmaL}
              leadTimeDays={purchase.leadTimeDays}
              safetyOverride={policy.safetyOverride}
              expectedLeadTimeDemand={purchase.expectedLeadTimeDemand}
              rop={purchase.rop}
            />
          </div>

          {/* Simulator */}
          <SectionTitle>Simular compra (what-if)</SectionTitle>
          <div className="mb-6">
            <SkuSimulator
              stock={selStock}
              forecast={forecast}
              orders={orders}
              policy={policy}
              shares={shares}
              today={inputs.today}
              history={history.global}
            />
          </div>

          {/* Open orders + recovery */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <SectionTitle>Pedidos em aberto</SectionTitle>
              {orders.length === 0 ? (
                <EmptyState title="Nenhum pedido em aberto" />
              ) : (
                <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">VO</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd</th>
                        <th className="px-3 py-2 text-right font-medium">ETA</th>
                        <th className="px-3 py-2 font-medium">Modal</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/5">
                      {orders.map((o) => (
                        <tr key={o.id} className="hover:bg-muted/40">
                          <td className="px-3 py-2">
                            <Link
                              prefetch={false}
                              href={`/dashboard/pedidos/${encodeURIComponent(o.vo ?? o.id)}`}
                              className="text-brand-500 transition-colors hover:text-brand-400 hover:underline"
                            >
                              {o.vo ?? 'ver'}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInt(o.qty)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtDate(o.eta)}</td>
                          <td className="px-3 py-2">{o.modal === 'air' ? 'Aéreo' : o.modal === 'sea' ? 'Marítimo' : '—'}</td>
                          <td className="px-3 py-2">{o.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <SectionTitle>Recuperação (global — todos os hubs)</SectionTitle>
              <RecoveryPanel
                skuBase={selected}
                stock={selStock}
                forecast={forecast}
                orders={orders}
                policy={policy}
                shares={shares}
                today={inputs.today}
                historicalRate={inputs.recoveryRates.get(selected) ?? null}
                refreshedAt={recoveryRefreshedAt}
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <KpiCard
                  label={<span className="inline-flex items-center gap-1">Consumo diário (global) <InfoHint id="daily-demand" /></span>}
                  value={fmtNum(projections.global.dailyDemand)}
                  hint="un/dia"
                />
                <KpiCard
                  label={<span className="inline-flex items-center gap-1">Cobertura atual <InfoHint id="doh" /></span>}
                  value={projections.global.dohNow != null ? `${fmtInt(projections.global.dohNow)}d` : '—'}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
      {sub != null && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}
