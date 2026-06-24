import { loadPlanningInputs, projectOne } from '@/lib/planning/load';
import { fetchStockHistory } from '@/lib/planning/source/history';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { ProjectionView } from '@/components/planning/ProjectionView';

export const dynamic = 'force-dynamic';

export default async function ProjectionPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const sp = await searchParams;
  const inputs = await loadPlanningInputs();

  if (inputs.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Projeção" title="Projeção de Estoque" />
        <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para projetar o estoque." />
      </div>
    );
  }

  const options = inputs.stocks
    .map((s) => ({ skuBase: s.skuBase, skuName: s.skuName }))
    .sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));
  const selected =
    sp.sku && inputs.stocks.some((s) => s.skuBase === sp.sku) ? sp.sku : options[0].skuBase;
  const selStock = inputs.stocks.find((s) => s.skuBase === selected);
  const [projections, history] = await Promise.all([
    projectOne(selected),
    fetchStockHistory(selStock?.skuName ?? ''),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Projeção"
        title="Projeção de Estoque"
        subtitle="Histórico (D-30) + horizonte de 150 dias — global, por hub e por SKU, com demanda, pedidos e recuperação"
      />
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />
      <ProjectionView options={options} selected={selected} projections={projections} history={history} />
    </div>
  );
}
