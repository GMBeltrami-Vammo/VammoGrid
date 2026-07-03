import { auth } from '@/auth';
import { safeComputeSnapshot } from '@/lib/planning/load';
import { fetchActiveScope } from '@/lib/planning/source/scope';
import { fetchSkuPolicies } from '@/lib/planning/source/policies';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { SkuTable, type SkuRow } from '@/components/planning/SkuTable';

export const dynamic = 'force-dynamic';

export default async function SkusPage() {
  // The SKUs page lists EVERY SKU always (ignoreSkuSelection + ignoreFilter) — neither
  // the default scope nor the top filter hides rows here. The checkbox = the hand-picked
  // selection, which IS "visible to the other pages". The top filters drive that
  // selection: `matchingSkus` = the SKUs passing the current top filter, which the table
  // syncs into the selection so filtering checks/unchecks SKUs.
  const [snap, scopeSet, policies, session] = await Promise.all([
    safeComputeSnapshot(true, true),
    fetchActiveScope(),
    fetchSkuPolicies(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

  // Which SKUs the current top filter (models / category / q / com previsão) matches.
  // null when no top filter is active (→ the table leaves the selection alone).
  const tf = snap.filter;
  const topFilterActive =
    tf.models.length > 0 || tf.category != null || tf.q.trim().length > 0 || tf.withForecast;
  const matchingSkus = topFilterActive
    ? (await safeComputeSnapshot(true, false)).stocks.map((s) => s.skuBase)
    : null;
  const filterSignature = JSON.stringify({
    models: tf.models,
    category: tf.category,
    q: tf.q,
    withForecast: tf.withForecast,
  });

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
      dohDays: null,
      status: 'OK',
      stockoutDate: null,
      isLate: false,
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
        eyebrow="Catálogo · Lista completa"
        title="SKUs"
        subtitle="Todos os SKUs. A caixa de seleção marca os SKUs visíveis nas demais páginas (análises) — quando há seleção, ela define exatamente o que as análises mostram. Use os filtros do topo (Com previsão, Modelos, categoria) para marcar/desmarcar em lote, ou marque manualmente."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {rows.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para listar os SKUs." />
      ) : (
        <SkuTable
          rows={rows}
          filter={snap.filter}
          scopeSkus={[...scopeSet]}
          matchingSkus={matchingSkus}
          filterSignature={filterSignature}
          isHead={isHead}
        />
      )}
    </div>
  );
}
