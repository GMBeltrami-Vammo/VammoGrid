import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildAllScenarioGrids } from '@/lib/planning/weekgrid';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchSuppliers, fetchSkuSuppliers } from '@/lib/planning/source/suppliers';
import { preferredSupplierBySku } from '@/lib/planning/supplierGroups';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { ScopeNotice } from '@/components/planning/ScopeNotice';
import { WeekGridView } from '@/components/planning/WeekGridView';

export const dynamic = 'force-dynamic';

const HORIZONS = [8, 12, 16, 20];

export default async function SemanasPage({
  searchParams,
}: {
  searchParams: Promise<{ sem?: string }>;
}) {
  const sp = await searchParams;
  const weeks = HORIZONS.includes(Number(sp.sem)) ? Number(sp.sem) : 16;

  const [snap, criteria, suppliers, skuSuppliers] = await Promise.all([
    safeComputeSnapshot(),
    fetchPurchaseCriteria(),
    fetchSuppliers(),
    fetchSkuSuppliers(),
  ]);

  if (snap.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Projeção Global" title="Projeção Global" />
        <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar o heatmap semanal." />
      </div>
    );
  }

  // All 4 scenarios computed once; the client toggles between them with no round-trip.
  const grids = buildAllScenarioGrids({
    inputs: snap,
    purchases: snap.purchases,
    weeks,
    criteria,
  });

  // Preferred supplier per SKU + names — powers "exportar sugestão → Novo Pedido",
  // grouped by each at-risk SKU's preferred supplier.
  const prefBySku = Object.fromEntries(preferredSupplierBySku(skuSuppliers));
  const supplierNames = Object.fromEntries(suppliers.map((s) => [s.supplierId, s.name]));

  return (
    <div>
      <PageHeader
        eyebrow="Projeção Global"
        title="Projeção Global"
        subtitle="Estoque projetado por SKU e semana. Base = só pedidos já registrados; os cenários simulam comprar QUANDO NECESSÁRIO via aéreo, marítimo ou o melhor dos dois (combinado)."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
      <ScopeNotice shown={snap.stocks.length} total={snap.catalogSize} />

      <WeekGridView grids={grids} weeks={weeks} prefBySku={prefBySku} supplierNames={supplierNames} />
    </div>
  );
}
