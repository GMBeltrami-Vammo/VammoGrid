import { auth } from '@/auth';
import { computeElaborations } from '@/lib/planning/load';
import { fmtInt } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { ProcurementView } from '@/components/planning/ProcurementView';
import { InfoHint } from '@/components/planning/InfoHint';

export const dynamic = 'force-dynamic';

// Compras rebuilt around the elaboration-trigger rule (sub-project B7): the list is
// computed fresh on every load (pure — no cron, no writes). A Head reviews each
// suggestion and confirms it (edit qty/modal first) → createElaboratedOrder drafts a
// prep_status='elaborado' pedido. The old statistical-ROP/CRITICAL-REORDER-OK view
// moved to the SKU detail; it no longer drives procurement.
export default async function ProcurementPage() {
  const [result, session] = await Promise.all([computeElaborations(), auth()]);
  const isHead = session?.user?.isHead ?? false;
  const { rows } = result;

  const total = rows.length;
  const late = rows.filter((r) => r.suggestion.isLate).length;
  const air = rows.filter((r) => r.suggestion.suggestedModal === 'air').length;
  const sea = rows.filter((r) => r.suggestion.suggestedModal === 'sea').length;

  return (
    <div>
      <PageHeader
        eyebrow="Compras"
        title="Elaboração de Compras"
        subtitle="SKUs cujo estoque projetado cai abaixo de 75 DOH em algum ponto — marítimo (lote mensal) se chega a tempo, senão aéreo. Revise e elabore o pedido; nada é gravado até confirmar."
      />
      <FreshnessBanner asOfDate={result.asOfDate} backend={result.backend} />

      {result.backend === 'none' ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar recomendações de compra." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Precisam de pedido <InfoHint id="elaboration-trigger" /></span>}
              value={fmtInt(total)}
              tone="brand"
            />
            <KpiCard label="Atrasados" value={fmtInt(late)} hint="aéreo não chega a tempo" tone="danger" />
            <KpiCard label="Marítimo" value={fmtInt(sea)} tone="default" />
            <KpiCard label="Aéreo" value={fmtInt(air)} tone="warning" />
          </div>

          <ProcurementView rows={rows} isHead={isHead} />
        </>
      )}
    </div>
  );
}
