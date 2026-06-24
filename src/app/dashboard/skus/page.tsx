import { safeComputeSnapshot } from '@/lib/planning/load';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { SkuTable, type SkuRow } from '@/components/planning/SkuTable';

export const dynamic = 'force-dynamic';

export default async function SkusPage() {
  // ignoreSkuSelection: the SKUs page is the selection MANAGER — it must list the
  // full (scoped) catalog so the user can check/uncheck any SKU. The hand-picked
  // set narrows every other analysis, not this table.
  const snap = await safeComputeSnapshot(true);

  const stockByBase = new Map(snap.stocks.map((s) => [s.skuBase, s]));

  const rows: SkuRow[] = snap.purchases.map((p) => {
    const stock = stockByBase.get(p.skuBase);
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
      dohDays,
      status: p.status,
      stockoutDate: p.stockoutDate,
      isLate: p.isLate,
    };
  });

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
        eyebrow="Catálogo"
        title="SKUs"
        subtitle="Todos os SKUs com estoque, cobertura e status de compra — filtre por categoria, classe ABC ou risco"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {rows.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para listar os SKUs." />
      ) : (
        <SkuTable rows={rows} filter={snap.filter} />
      )}
    </div>
  );
}
