import { auth } from '@/auth';
import { safeComputeSnapshot } from '@/lib/planning/load';
import { fetchActiveScope } from '@/lib/planning/source/scope';
import { fetchSkuPolicies } from '@/lib/planning/source/policies';
import { fetchSuppliers, fetchSkuSuppliers } from '@/lib/planning/source/suppliers';
import { fetchFilterPresets } from '@/lib/planning/source/filterPresets';
import { preferredSupplierBySku } from '@/lib/planning/supplierGroups';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { SkuTable, type SkuRow } from '@/components/planning/SkuTable';

export const dynamic = 'force-dynamic';

export default async function SkusPage() {
  // The SKUs page lists EVERY SKU always (ignoreSkuSelection + ignoreFilter) — this is
  // the app's single control center: the local filters below narrow the visible list,
  // and the checkbox selection ("selecionar visíveis") is THE recorte every other page
  // sees. No top-bar filter exists anymore.
  const [snap, scopeSet, policies, suppliers, skuSuppliers, presets, session] = await Promise.all([
    safeComputeSnapshot(true, true),
    fetchActiveScope(),
    fetchSkuPolicies(),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchFilterPresets(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

  const stockByBase = new Map(snap.stocks.map((s) => [s.skuBase, s]));
  const prefBySku = preferredSupplierBySku(skuSuppliers);
  const supplierNameById = new Map(suppliers.map((s) => [s.supplierId, s.name]));
  const supplierNameFor = (skuBase: string): string | null => {
    const sid = prefBySku.get(skuBase);
    return sid ? (supplierNameById.get(sid) ?? null) : null;
  };

  const rows: SkuRow[] = snap.purchases.map((p) => {
    const stock = stockByBase.get(p.skuBase);
    const policy = snap.policies.get(p.skuBase);
    const dailyDemand =
      p.leadTimeDays > 0 ? p.expectedLeadTimeDemand / p.leadTimeDays : 0;
    const dohDays =
      dailyDemand > 0 ? Math.round(p.onHand / dailyDemand) : null;

    return {
      skuBase: p.skuBase,
      skuName: p.skuName,
      category: stock?.category ?? null,
      abcClass: p.abcClass,
      onHand: p.onHand,
      byHub: {
        osasco: stock?.byHub.osasco ?? 0,
        mooca: stock?.byHub.mooca ?? 0,
        sbc: stock?.byHub.sbc ?? 0,
      },
      dailyDemand: Math.round(dailyDemand * 100) / 100,
      dohDays,
      status: p.status,
      stockoutDate: p.stockoutDate,
      isLate: p.isLate,
      models: [...(snap.compatModels.get(p.skuBase) ?? [])],
      hasForecast: snap.forecasts.has(p.skuBase),
      isNational: policy?.leadTimeSource === 'national-file',
      // Recovery — the resolved policy value (override else stock), i.e. what the engine uses.
      isRepairable: policy?.isRepairable ?? stock?.isRepairable ?? false,
      recoveryRate: policy?.recoveryRate ?? 0,
      recoveryTurnaroundDays: policy?.recoveryTurnaroundDays ?? 14,
      supplierName: supplierNameFor(p.skuBase),
    };
  });

  // Manually-added SKUs (a policy exists but the warehouse has no inventory yet) —
  // union them in so they're visible/configurable right after being added. They show
  // zero stock / no coverage until inventory for them lands.
  const presentBases = new Set(snap.purchases.map((p) => p.skuBase));
  for (const [base, pol] of policies) {
    if (presentBases.has(base)) continue;
    rows.push({
      skuBase: base,
      skuName: pol.skuName ?? base,
      category: null,
      abcClass: pol.abcClass ?? 'C',
      onHand: 0,
      byHub: { osasco: 0, mooca: 0, sbc: 0 },
      dailyDemand: 0,
      dohDays: null,
      status: 'OK',
      stockoutDate: null,
      isLate: false,
      models: [...(snap.compatModels.get(base) ?? [])],
      hasForecast: snap.forecasts.has(base),
      isNational: pol.leadTimeSource === 'national-file',
      isRepairable: pol.isRepairable ?? false,
      recoveryRate: pol.recoveryRate ?? 0,
      recoveryTurnaroundDays: pol.recoveryTurnaroundDays ?? 14,
      supplierName: supplierNameFor(base),
    });
  }

  // Sort: CRITICAL first, then REORDER, then OK; within each group by name
  const ORDER = { CRITICAL: 0, REORDER: 1, OK: 2 } as const;
  rows.sort((a, b) => {
    const d = ORDER[a.status] - ORDER[b.status];
    if (d !== 0) return d;
    return a.skuName.localeCompare(b.skuName, 'pt-BR');
  });

  return (
    <div>
      <PageHeader
        eyebrow="Catálogo · Centro de controle"
        title="SKUs"
        subtitle="Todos os SKUs, sempre. Os filtros abaixo recortam a lista visível; a caixa de seleção define exatamente o que as demais páginas (análises) mostram — filtre e use “selecionar visíveis” para materializar o recorte."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {rows.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para listar os SKUs." />
      ) : (
        <SkuTable
          rows={rows}
          initialSelection={snap.filter.skus}
          scopeSkus={[...scopeSet]}
          suppliers={suppliers}
          presets={presets}
          isHead={isHead}
        />
      )}
    </div>
  );
}
