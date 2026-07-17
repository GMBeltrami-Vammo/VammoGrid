import { cookies } from 'next/headers';
import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildAllScenarioGrids, type PlanByModal } from '@/lib/planning/weekgrid';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
import { modalsForSupplier, preferredSupplierBySku, type ModalOption } from '@/lib/planning/supplierGroups';
import { MODAL_CFG_COOKIE, parseModalCfg } from '@/lib/planning/modalConfig';
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

  const [snap, criteria, suppliers, skuSuppliers, supplierModals, cookieStore] = await Promise.all([
    safeComputeSnapshot(),
    fetchPurchaseCriteria(),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchSupplierModals(),
    cookies(),
  ]);
  // Shared per-modal config (same session cookie Novo Pedido writes) — drives the scenarios
  // so "Courier/Aéreo/Marítimo qdo necessário" here match the Novo Pedido suggestion.
  const cfg = parseModalCfg(cookieStore.get(MODAL_CFG_COOKIE)?.value);

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
  // Lead is overridden by the shared config (sim lead) so the scenario timing matches Novo Pedido.
  const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
  const prefMap = preferredSupplierBySku(skuSuppliers);
  const modalsBySku = new Map<string, ModalOption[]>();
  for (const [sku, sid] of prefMap) {
    const sup = supplierById.get(sid);
    if (!sup) continue;
    const modais = modalsForSupplier(sup, supplierModals).map((mo) => {
      const lead = cfg[sid]?.[mo.name]?.lead;
      return lead && lead > 0 ? { ...mo, leadDays: lead } : mo;
    });
    modalsBySku.set(sku, modais);
  }
  // Per-modal piso/cadência (by modal name, merged across suppliers) — the layered floors.
  const planByModal: PlanByModal = {};
  for (const byModal of Object.values(cfg)) {
    for (const [name, e] of Object.entries(byModal)) {
      const cur = planByModal[name] ?? {};
      if (e.piso && e.piso > 0) cur.minDoh = e.piso;
      if (e.cad && e.cad > 0) cur.cadenceDays = e.cad;
      planByModal[name] = cur;
    }
  }

  // All scenarios computed once (already reflecting the shared config); client toggles instantly.
  const { scenarios, grids } = buildAllScenarioGrids({
    inputs: { ...snap, modalsBySku },
    purchases: snap.purchases,
    weeks,
    criteria,
    planByModal,
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
