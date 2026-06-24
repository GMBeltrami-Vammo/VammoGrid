import { loadPlanningInputs, projectOneCompare } from '@/lib/planning/load';
import { fetchStockHistory } from '@/lib/planning/source/history';
import { resolveShares } from '@/lib/planning/allocation';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { EmptyState, FreshnessBanner, PageHeader, SectionTitle } from '@/components/planning/ui';
import { EstoqueView } from '@/components/planning/EstoqueView';
import { RecoveryPanel } from '@/components/planning/RecoveryPanel';

export const dynamic = 'force-dynamic';

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const sp = await searchParams;
  const inputs = await loadPlanningInputs();

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

  const [compare, history] = await Promise.all([
    projectOneCompare(selected),
    fetchStockHistory(selStock.skuBase, selStock.byHub, 30),
  ]);
  const projections = compare?.projections ?? null;
  const baseline = compare?.baseline ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Estoque"
        title="Estoque"
        subtitle="Janela D-30→D+30 e horizonte D0→D+150 — histórico real, projeção e banda lo–hi por SKU e hub"
      />
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      <EstoqueView
        options={options}
        selected={selected}
        projections={projections}
        baseline={baseline}
        history={history}
      />

      <div className="mt-8">
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
        />
      </div>
    </div>
  );
}
