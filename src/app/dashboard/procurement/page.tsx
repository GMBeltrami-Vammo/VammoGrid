import { safeComputeSnapshot } from '@/lib/planning/load';
import {
  actionablePurchases,
  countByStatus,
  totalOrderCost,
} from '@/lib/planning/selectors';
import { fmtBRL, fmtInt } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { ProcurementTable } from '@/components/planning/ProcurementTable';

export const dynamic = 'force-dynamic';

export default async function ProcurementPage() {
  const snap = await safeComputeSnapshot();
  const rows = actionablePurchases(snap.purchases);
  const counts = countByStatus(snap.purchases);
  const cost = totalOrderCost(rows.filter((p) => p.orderQty > 0));

  return (
    <div>
      <PageHeader
        eyebrow="Compras"
        title="Planejamento de Compras"
        subtitle="Quando e quanto comprar — ponto de recompra, estoque de segurança e data-limite (buy-by) por SKU"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {snap.stocks.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar recomendações de compra." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Críticos" value={fmtInt(counts.critical)} tone="danger" />
            <KpiCard label="Recompra" value={fmtInt(counts.reorder)} tone="warning" />
            <KpiCard label="Compras atrasadas" value={fmtInt(counts.late)} hint="buy-by no passado" tone="danger" />
            <KpiCard label="Custo total sugerido" value={fmtBRL(cost)} tone="brand" />
          </div>

          {counts.late > 0 && (
            <p className="mb-4 rounded-lg bg-alert-warning/10 px-3 py-2 text-xs text-[color:var(--color-alert-warning)] ring-1 ring-alert-warning/30">
              Itens internacionais têm lead ≈ 110d ≈ horizonte de previsão — quando rompem dentro do
              horizonte, o buy-by cai no passado. Não é erro: priorize expedição (marítimo→aéreo).
            </p>
          )}

          <ProcurementTable rows={rows} />
        </>
      )}
    </div>
  );
}
