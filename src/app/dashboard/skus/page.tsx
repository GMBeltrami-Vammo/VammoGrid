import { auth } from '@/auth';
import { safeComputeSnapshot } from '@/lib/planning/load';
import { fetchActiveScope } from '@/lib/planning/source/scope';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { SkuTable, type SkuRow } from '@/components/planning/SkuTable';

export const dynamic = 'force-dynamic';

export default async function SkusPage() {
  // ignoreSkuSelection: the SKUs page is the full catalog + scope MANAGER — it must
  // list EVERY SKU (bypassing the default-scope narrowing) so the user can add/remove
  // any SKU to/from the default universe. The hand-picked cookie set + the default
  // scope both narrow every OTHER analysis, not this table.
  const [snap, scopeSet, session] = await Promise.all([
    safeComputeSnapshot(true),
    fetchActiveScope(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

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
        eyebrow="Catálogo · Lista completa"
        title="SKUs"
        subtitle="Todos os SKUs (catálogo completo). Marque quais entram no escopo padrão — o conjunto que todas as análises usam por padrão. Filtre por categoria, classe ABC, risco ou escopo."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {rows.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para listar os SKUs." />
      ) : (
        <SkuTable
          rows={rows}
          filter={snap.filter}
          scopeSkus={[...scopeSet]}
          isHead={isHead}
        />
      )}
    </div>
  );
}
