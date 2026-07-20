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
  searchParams: Promise<{ sem?: string; forn?: string; modais?: string }>;
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
  // Shared per-modal config (piso/cadência/lead) — the SAME session cookie Novo Pedido writes.
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

  // Simulation lens: ONE supplier drives the modais/leads for ALL shown SKUs (picked in the
  // dropdown). Default = the first active supplier; `forn` (URL) overrides it; `modais` (URL,
  // comma list) is the enabled subset — absent = all of the supplier's modais, "" = none.
  const activeSuppliers = suppliers.filter((s) => s.active);
  const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
  const selectedSupplierId =
    (sp.forn && supplierById.has(sp.forn) ? sp.forn : '') || activeSuppliers[0]?.supplierId || '';
  const selectedSupplier = supplierById.get(selectedSupplierId) ?? null;
  const selModais = modalsForSupplier(selectedSupplier, supplierModals);
  const selNames = selModais.map((m) => m.name);
  const enabledModais =
    sp.modais === undefined
      ? selNames
      : sp.modais.split(',').map((s) => s.trim()).filter((n) => selNames.includes(n));

  // The selected supplier's ENABLED modais (with sim-lead overrides) — applied to EVERY shown
  // SKU, so the heatmap is a complete "what-if via this supplier" vision.
  const enabledWithLead: ModalOption[] = selModais
    .filter((m) => enabledModais.includes(m.name))
    .map((m) => {
      const lead = cfg[selectedSupplierId]?.[m.name]?.lead;
      return lead && lead > 0 ? { ...m, leadDays: lead } : m;
    });
  const modalsBySku = new Map<string, ModalOption[]>();
  for (const s of snap.stocks) modalsBySku.set(s.skuBase, enabledWithLead);

  // Per-modal piso/cadência (from the SELECTED supplier's config) — the layered floors.
  const planByModal: PlanByModal = {};
  for (const [name, e] of Object.entries(cfg[selectedSupplierId] ?? {})) {
    const cur: { minDoh?: number; cadenceDays?: number } = {};
    if (e.piso && e.piso > 0) cur.minDoh = e.piso;
    if (e.cad && e.cad > 0) cur.cadenceDays = e.cad;
    if (Object.keys(cur).length) planByModal[name] = cur;
  }

  // All scenarios computed once (reflecting the lens); the client flips Base ↔ Com-sugestão.
  const { scenarios, grids } = buildAllScenarioGrids({
    inputs: { ...snap, modalsBySku },
    purchases: snap.purchases,
    weeks,
    criteria,
    planByModal,
  });

  // "Com sugestão" grid: the combined cascade (>1 modal), else the single modal's when-needed,
  // else baseline (no modal enabled).
  const suggestedKey =
    scenarios.find((s) => s.kind === 'combined')?.key ??
    scenarios.find((s) => s.kind === 'modal')?.key ??
    'baseline';

  // Export → Novo Pedido groups at-risk SKUs by their REAL preferred supplier (independent of
  // the simulation lens) so the created order goes to the right place.
  const prefMap = preferredSupplierBySku(skuSuppliers);
  const prefBySku = Object.fromEntries(prefMap);
  const supplierNames = Object.fromEntries(suppliers.map((s) => [s.supplierId, s.name]));

  return (
    <div>
      <PageHeader
        eyebrow="Projeção Global"
        title="Projeção Global"
        subtitle="Estoque projetado por SKU e semana. Base = só pedidos já registrados; “com sugestão” simula comprar QUANDO NECESSÁRIO pelos modais habilitados do fornecedor escolhido (só simulação, aplicado a todos os SKUs)."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
      <ScopeNotice shown={snap.stocks.length} total={snap.catalogSize} />

      <WeekGridView
        grids={grids}
        weeks={weeks}
        suggestedKey={suggestedKey}
        suppliers={activeSuppliers.map((s) => ({ supplierId: s.supplierId, name: s.name }))}
        selectedSupplierId={selectedSupplierId}
        modais={selModais}
        enabledModais={enabledModais}
        prefBySku={prefBySku}
        supplierNames={supplierNames}
      />
    </div>
  );
}
