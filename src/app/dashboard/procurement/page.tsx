import { auth } from '@/auth';
import { computeElaborations } from '@/lib/planning/load';
import { parseOrderRules } from '@/lib/planning/elaboration';
import { fetchSuppliers, fetchSkuSuppliers } from '@/lib/planning/source/suppliers';
import { preferredSupplierBySku } from '@/lib/planning/supplierGroups';
import { fmtInt } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { ProcurementView } from '@/components/planning/ProcurementView';
import { ScopeNotice } from '@/components/planning/ScopeNotice';
import { InfoHint } from '@/components/planning/InfoHint';

export const dynamic = 'force-dynamic';

// Novo Pedido: the SKUs whose projected coverage drops below the floor (computed fresh
// on load — pure, no writes). The user checks the SKUs to include, picks ONE modal for
// the whole order, and "Criar pedido" writes a single pedido (one VO, N lines).
// Per-pedido rule overrides (7b) live in ?rules= — they shape THIS computation only.
export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ rules?: string }>;
}) {
  const sp = await searchParams;
  const rules = parseOrderRules(sp.rules);
  const [result, suppliers, skuSuppliers, session] = await Promise.all([
    computeElaborations(false, rules),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;
  const { rows } = result;
  const activeSuppliers = suppliers.filter((s) => s.active).map((s) => ({ supplierId: s.supplierId, name: s.name }));
  const prefBySku = Object.fromEntries(preferredSupplierBySku(skuSuppliers));

  const total = rows.length;
  const late = rows.filter((r) => r.suggestion.isLate).length;

  return (
    <div>
      <PageHeader
        eyebrow="Compras"
        title="Novo Pedido"
        subtitle="SKUs que atingem o critério de compra no horizonte (DOH mínimo ou estoque mín + segurança — configurável em Admin). Marque os que entram no pedido, escolha o modal e clique em Criar pedido."
      />
      <FreshnessBanner asOfDate={result.asOfDate} backend={result.backend} />
      <ScopeNotice shown={result.skuCount} total={result.catalogSize} />

      {result.backend === 'none' ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar recomendações de compra." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Precisam de pedido <InfoHint id="elaboration-trigger" /></span>}
              value={fmtInt(total)}
              tone="brand"
            />
            <KpiCard label="Atrasados" value={fmtInt(late)} hint="não chegam a tempo nem por aéreo" tone="danger" />
            <KpiCard label="No horizonte" value={fmtInt(total)} hint="cobertura abaixo do piso" tone="default" />
          </div>

          <ProcurementView
            rows={rows}
            isHead={isHead}
            criteria={result.criteria}
            rules={result.rules ?? null}
            today={result.today}
            forecastAsOf={result.asOfDate}
            suppliers={activeSuppliers}
            prefBySku={prefBySku}
          />
        </>
      )}
    </div>
  );
}
