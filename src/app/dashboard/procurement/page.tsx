import { auth } from '@/auth';
import { computeElaborations } from '@/lib/planning/load';
import { parseOrderRules } from '@/lib/planning/elaboration';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
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
  searchParams: Promise<{ rules?: string; supplier?: string; skus?: string }>;
}) {
  const sp = await searchParams;
  const rules = parseOrderRules(sp.rules);
  // Deep link from Projeção Global's "exportar → Novo Pedido": preselect a supplier and
  // restrict the initial inclusion to the exported SKU base codes (URL-safe, '~'-joined).
  const initialSupplierId = sp.supplier?.trim() || undefined;
  const initialSkus = sp.skus
    ? sp.skus.split('~').map((s) => s.trim()).filter(Boolean).slice(0, 500)
    : undefined;
  const [result, suppliers, skuSuppliers, supplierModals, session] = await Promise.all([
    computeElaborations(false, rules),
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchSupplierModals(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;
  const { rows } = result;
  const activeSuppliers = suppliers
    .filter((s) => s.active)
    .map((s) => ({
      supplierId: s.supplierId,
      name: s.name,
      kind: s.kind,
      leadTimeSeaDays: s.leadTimeSeaDays,
      leadTimeAirDays: s.leadTimeAirDays,
    }));
  // All SKUs linked to each supplier (not just preferred) — the builder narrows to the
  // chosen supplier's SKUs.
  const skusBySupplier: Record<string, string[]> = {};
  for (const l of skuSuppliers) (skusBySupplier[l.supplierId] ??= []).push(l.skuBase);

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
            supplierModals={supplierModals}
            skusBySupplier={skusBySupplier}
            initialSupplierId={initialSupplierId}
            initialSkus={initialSkus}
          />
        </>
      )}
    </div>
  );
}
