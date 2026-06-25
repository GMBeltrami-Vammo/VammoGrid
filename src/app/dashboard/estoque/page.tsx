import { loadPlanningInputs, projectOneCompare } from '@/lib/planning/load';
import { computeArrivals } from '@/lib/planning/projection';
import { purchaseForSku } from '@/lib/planning/purchase';
import { fetchStockHistory } from '@/lib/planning/source/history';
import { fetchRecoveryRefreshedAt } from '@/lib/planning/recoveryRefresh';
import { resolveShares } from '@/lib/planning/allocation';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { HUB_LIST } from '@/constants/planningHubs';
import { fmtBRL, fmtDate, fmtInt, fmtNum } from '@/lib/planning/format';
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
import { RecoveryPanel } from '@/components/planning/RecoveryPanel';
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
  searchParams: Promise<{ sku?: string }>;
}) {
  const sp = await searchParams;
  // ignoreSkuSelection: deep-links resolve any SKU, and the selector lists the full
  // (scoped) catalog rather than only the hand-picked focus set.
  const inputs = await loadPlanningInputs(true);

  if (inputs.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Estoque" title="Estoque" />
        <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para visualizar o estoque." />
      </div>
    );
  }

  const options = inputs.stocks
    .map((s) => ({ skuBase: s.skuBase, skuName: s.skuName }))
    .sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));

  const selected =
    sp.sku && inputs.stocks.some((s) => s.skuBase === sp.sku) ? sp.sku : options[0].skuBase;

  const selStock = inputs.stocks.find((s) => s.skuBase === selected)!;
  const forecast = inputs.forecasts.get(selected) ?? null;
  const orders = inputs.ordersBySku.get(selected) ?? [];
  const policy =
    inputs.policies.get(selected) ??
    defaultPolicyFor(selected, selStock, forecast?.abcClass ?? 'C', inputs.today);
  const shares = resolveShares(selStock, inputs.shares.get(selected));

  const [compare, history, recoveryRefreshedAt] = await Promise.all([
    projectOneCompare(selected),
    fetchStockHistory(selStock.skuBase, selStock.byHub, 30),
    fetchRecoveryRefreshedAt(),
  ]);
  const projections = compare?.projections ?? null;
  const baseline = compare?.baseline ?? null;
  const arrivals = computeArrivals(orders, inputs.today);
  const purchase = purchaseForSku({
    skuBase: selected,
    skuName: selStock.skuName,
    forecast,
    stock: selStock,
    orders,
    policy,
    today: inputs.today,
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
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      {/* SKU selector + scope toggle + D-30→D+30 and D0→D+150 charts */}
      <EstoqueView
        options={options}
        selected={selected}
        projections={projections}
        baseline={baseline}
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
          </div>

          {/* Purchase recommendation */}
          <SectionTitle>Recomendação de compra</SectionTitle>
          <div className="mb-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="mb-3 flex items-center gap-2">
              <StatusPill status={purchase.status} />
              {purchase.isLate && <LatePill />}
              <span className="text-sm text-muted-foreground">{purchase.reasoning}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric
                label={<span className="inline-flex items-center gap-1">Ponto recompra <InfoHint id="rop" /></span>}
                value={fmtInt(purchase.rop)}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Estoque segurança <InfoHint id="safety" /></span>}
                value={fmtInt(purchase.safetyStock)}
              />
              <Metric
                label={<span className="inline-flex items-center gap-1">Demanda no lead <InfoHint id="expected-lead-demand" /></span>}
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
              <Metric
                label={<span className="inline-flex items-center gap-1">Custo estimado <InfoHint id="est-cost" /></span>}
                value={purchase.estCost != null && purchase.orderQty > 0 ? fmtBRL(purchase.estCost) : '—'}
              />
            </div>
          </div>

          {/* Safety stock (global) — editable, feeds the purchase suggestion */}
          <SectionTitle>Estoque de segurança (global)</SectionTitle>
          <div className="mb-6">
            <SafetyStockPanel
              skuBase={selected}
              abcClass={policy.abcClass}
              sigmaL={purchase.sigmaL}
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
                          <td className="px-3 py-2">{o.vo ?? '—'}</td>
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

function Metric({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
