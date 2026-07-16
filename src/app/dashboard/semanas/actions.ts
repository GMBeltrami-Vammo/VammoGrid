'use server';

import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildWeekGrid, type WeekGrid } from '@/lib/planning/weekgrid';
import { fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';
import { fetchSkuSuppliers } from '@/lib/planning/source/suppliers';
import { preferredSupplierBySku } from '@/lib/planning/supplierGroups';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import type { SkuPolicy, WeekGridScenario } from '@/types/planning';

// ─────────────────────────────────────────────────────────────────────────────
// EPHEMERAL "what-if" for Projeção Global — recompute ONLY the on-page suggestion
// scenarios (aéreo / marítimo / combinado) with hypothetical lead times (per supplier)
// and coverage floors (per modal). Nothing is persisted: Novo Pedido and Pedidos keep
// using the supplier's real leads + the global criteria. The engine runs server-side,
// so this is a Server Action the client calls on "Simular"; it returns swapped grids.
//
// Lead overrides are applied per supplier — patched onto the policies of that supplier's
// SKUs (preferred link), so a SKU's suggested arrivals shift in time. Coverage floors are
// applied per SCENARIO (the heatmap engine's floor is a single global criteria): the aéreo
// tab uses airMinDoh, the marítimo/combinado tabs use seaMinDoh, the baseline keeps the
// real global criteria.
// ─────────────────────────────────────────────────────────────────────────────

export interface SimLeadOverride {
  seaLead?: number | null;
  airLead?: number | null;
}

export interface SimInput {
  weeks: number;
  /** supplier_id → hypothetical sea/air lead (days). Absent/blank → the SKU's real lead. */
  leadBySupplier: Record<string, SimLeadOverride>;
  /** Hypothetical coverage floor (DOH) for the marítimo/combinado scenarios. */
  seaMinDoh?: number | null;
  /** Hypothetical coverage floor (DOH) for the aéreo scenario. */
  airMinDoh?: number | null;
}

export async function simulateWeekGrids(
  input: SimInput,
): Promise<{ ok: boolean; grids?: Record<WeekGridScenario, WeekGrid>; error?: string }> {
  try {
    const [snap, baseCriteria, skuSuppliers] = await Promise.all([
      safeComputeSnapshot(),
      fetchPurchaseCriteria(),
      fetchSkuSuppliers(),
    ]);
    if (snap.stocks.length === 0) return { ok: false, error: 'Sem dados para simular.' };

    const prefBySku = preferredSupplierBySku(skuSuppliers);
    const hasLeadOverride = Object.values(input.leadBySupplier).some(
      (o) => (o.seaLead != null && o.seaLead > 0) || (o.airLead != null && o.airLead > 0),
    );

    // Patch each SKU's policy leads from its preferred supplier's override (if any).
    let policies = snap.policies;
    if (hasLeadOverride) {
      policies = new Map<string, SkuPolicy>(snap.policies);
      for (const [sku, policy] of policies) {
        const sid = prefBySku.get(sku);
        const ov = sid ? input.leadBySupplier[sid] : undefined;
        if (!ov) continue;
        const seaLead = ov.seaLead != null && ov.seaLead > 0 ? Math.round(ov.seaLead) : policy.leadTimeSeaDays;
        const airLead = ov.airLead != null && ov.airLead > 0 ? Math.round(ov.airLead) : policy.leadTimeAirDays;
        policies.set(sku, { ...policy, leadTimeSeaDays: seaLead, leadTimeAirDays: airLead });
      }
    }

    const inputs = { ...snap, policies };
    const weeks = input.weeks;
    const floorCriteria = (v: number | null | undefined): PurchaseCriteria =>
      v != null && v > 0 ? { mode: 'doh', dohThreshold: Math.round(v) } : baseCriteria;
    const seaCrit = floorCriteria(input.seaMinDoh);
    const airCrit = floorCriteria(input.airMinDoh);

    const grids: Record<WeekGridScenario, WeekGrid> = {
      baseline: buildWeekGrid({ inputs, purchases: snap.purchases, weeks, scenario: 'baseline', criteria: baseCriteria }),
      air_only: buildWeekGrid({ inputs, purchases: snap.purchases, weeks, scenario: 'air_only', criteria: airCrit }),
      sea_only: buildWeekGrid({ inputs, purchases: snap.purchases, weeks, scenario: 'sea_only', criteria: seaCrit }),
      complete: buildWeekGrid({ inputs, purchases: snap.purchases, weeks, scenario: 'complete', criteria: seaCrit }),
    };
    return { ok: true, grids };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro na simulação.' };
  }
}
