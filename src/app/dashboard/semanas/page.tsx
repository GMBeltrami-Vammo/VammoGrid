import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildAllScenarioGrids } from '@/lib/planning/weekgrid';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
import { modalsForSupplier, preferredSupplierBySku, type ModalOption } from '@/lib/planning/supplierGroups';
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

  const [snap, criteria, suppliers, skuSuppliers, supplierModals] = await Promise.all([
    safeComputeSnapshot(),
    fetchPurchaseCriteria(),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchSupplierModals(),
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

  // Per-SKU transport modais (from the preferred supplier) — drives the N-modal scenarios.
  const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
  const prefMap = preferredSupplierBySku(skuSuppliers);
  const modalsBySku = new Map<string, ModalOption[]>();
  for (const [sku, sid] of prefMap) {
    const sup = supplierById.get(sid);
    if (sup) modalsBySku.set(sku, modalsForSupplier(sup, supplierModals));
  }

  // All scenarios computed once; the client toggles between them with no round-trip.
  const { scenarios, grids } = buildAllScenarioGrids({
    inputs: { ...snap, modalsBySku },
    purchases: snap.purchases,
    weeks,
    criteria,
  });

  // Preferred supplier per SKU + names — powers "exportar sugestão → Novo Pedido".
  const prefBySku = Object.fromEntries(prefMap);
  const supplierNames = Object.fromEntries(suppliers.map((s) => [s.supplierId, s.name]));
  // Active suppliers with their modais — the ephemeral simulation panel's per-modal knobs.
  const simSuppliers = suppliers
    .filter((s) => s.active)
    .map((s) => ({ supplierId: s.supplierId, name: s.name, modais: modalsForSupplier(s, supplierModals) }));

  return (
    <div>
      <PageHeader
        eyebrow="Projeção Global"
        title="Projeção Global"
        subtitle="Estoque projetado por SKU e semana. Base = só pedidos já registrados; os cenários simulam comprar QUANDO NECESSÁRIO por cada modal do fornecedor (Courier/Aéreo/Marítimo…) ou pelo combinado."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
      <ScopeNotice shown={snap.stocks.length} total={snap.catalogSize} />

      <WeekGridView
        scenarios={scenarios}
        grids={grids}
        weeks={weeks}
        prefBySku={prefBySku}
        supplierNames={supplierNames}
        simSuppliers={simSuppliers}
      />
    </div>
  );
}
