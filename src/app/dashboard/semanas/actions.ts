'use server';

import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildAllScenarioGrids, type WeekGrid } from '@/lib/planning/weekgrid';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
import { modalsForSupplier, preferredSupplierBySku, type ModalOption } from '@/lib/planning/supplierGroups';
import type { ScenarioMeta } from '@/types/planning';

// ─────────────────────────────────────────────────────────────────────────────
// EPHEMERAL "what-if" for Projeção Global — recompute the on-page suggestion scenarios
// with hypothetical modal leads (per supplier × modal, incl. Courier) and coverage floors
// (per modal). Nothing is persisted: Novo Pedido and Pedidos keep using the supplier's real
// leads + the global criteria. The N-modal engine runs server-side, so this is a Server
// Action the client calls on "Simular"; it returns swapped scenario grids.
// ─────────────────────────────────────────────────────────────────────────────

export interface SimInput {
  weeks: number;
  /** supplier_id → { modalName → hypothetical lead (days) }. */
  leadBySupplierModal: Record<string, Record<string, number>>;
  /** modalName → hypothetical coverage floor (DOH) for that modal's scenario. */
  floorByModal: Record<string, number>;
}

export async function simulateWeekGrids(
  input: SimInput,
): Promise<{ ok: boolean; scenarios?: ScenarioMeta[]; grids?: Record<string, WeekGrid>; error?: string }> {
  try {
    const [snap, criteria, suppliers, skuSuppliers, supplierModals] = await Promise.all([
      safeComputeSnapshot(),
      fetchPurchaseCriteria(),
      fetchSuppliers(),
      fetchSkuSuppliers(),
      fetchSupplierModals(),
    ]);
    if (snap.stocks.length === 0) return { ok: false, error: 'Sem dados para simular.' };

    const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
    const prefMap = preferredSupplierBySku(skuSuppliers);

    // Per-SKU modais from the preferred supplier, with the hypothetical lead overrides applied.
    const modalsBySku = new Map<string, ModalOption[]>();
    for (const [sku, sid] of prefMap) {
      const sup = supplierById.get(sid);
      if (!sup) continue;
      const overrides = input.leadBySupplierModal[sid];
      const modais = modalsForSupplier(sup, supplierModals).map((m) =>
        overrides?.[m.name] && overrides[m.name] > 0 ? { ...m, leadDays: Math.round(overrides[m.name]) } : m,
      );
      modalsBySku.set(sku, modais);
    }

    const { scenarios, grids } = buildAllScenarioGrids({
      inputs: { ...snap, modalsBySku },
      purchases: snap.purchases,
      weeks: input.weeks,
      criteria,
      floorByScenario: input.floorByModal, // keys are modal names = scenario keys
    });
    return { ok: true, scenarios, grids };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro na simulação.' };
  }
}
