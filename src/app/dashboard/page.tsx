import Link from 'next/link';
import { safeComputeSnapshot } from '@/lib/planning/load';
import {
  actionablePurchases,
  countByStatus,
  healthScore,
  networkOnHand,
  totalOrderCost,
  transfersByHub,
  upcomingStockouts,
} from '@/lib/planning/selectors';
import { fmtBRL, fmtDate, fmtInt } from '@/lib/planning/format';
import { HUB_LIST } from '@/constants/planningHubs';
import {
  EmptyState,
  FreshnessBanner,
  KpiCard,
  LatePill,
  PageHeader,
  SectionTitle,
  StatusPill,
} from '@/components/planning/ui';

export const dynamic = 'force-dynamic';

export default async function ExecutiveDashboard() {
  const snap = await safeComputeSnapshot();
  const counts = countByStatus(snap.purchases);
  const score = healthScore(snap.purchases);
  const actionable = actionablePurchases(snap.purchases);
  const stockouts = upcomingStockouts(snap.purchases, snap.today, 30);
  const cost = totalOrderCost(actionable.filter((p) => p.orderQty > 0));
  const tByHub = transfersByHub(snap.transfers);
  const net = networkOnHand(snap.stocks);

  const skuHref = (sku: string) => `/dashboard/sku/${encodeURIComponent(sku)}`;

  return (
    <div>
      <PageHeader
        eyebrow="Centro de Operações"
        title="Visão Geral"
        subtitle="Saúde do estoque, rupturas previstas e ações recomendadas para os próximos 150 dias"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {snap.stocks.length === 0 ? (
        <EmptyState
          title="Sem dados de estoque"
          hint="Configure CLICKHOUSE_* ou METABASE_URL + METABASE_API_KEY para carregar estoque, previsão e movimentos."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard
              label="Saúde do estoque"
              value={`${score}`}
              hint="0–100"
              tone={score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'}
            />
            <KpiCard
              label="SKUs em risco"
              value={fmtInt(counts.critical + counts.reorder)}
              hint={`${counts.critical} críticos · ${counts.reorder} recompra`}
              tone={counts.critical > 0 ? 'danger' : 'warning'}
            />
            <KpiCard
              label="Rupturas ≤ 30d"
              value={fmtInt(stockouts.length)}
              hint={`${counts.late} com compra atrasada`}
              tone={stockouts.length > 0 ? 'danger' : 'success'}
            />
            <KpiCard
              label="Compras sugeridas"
              value={fmtBRL(cost)}
              hint={`${actionable.filter((p) => p.orderQty > 0).length} SKUs`}
              tone="brand"
            />
            <KpiCard
              label="Transferências"
              value={fmtInt(snap.transfers.length)}
              hint="próximo ciclo (terça)"
              tone="brand"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HUB_LIST.map((h) => (
              <Link
                key={h.id}
                href={`/dashboard/hub/${h.id}`}
                className="block rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-brand-500/40"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{h.name}</p>
                  {h.isCentral && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-brand-500/15 text-brand-600">
                      Central
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xl font-bold tabular-nums">{fmtInt(net.byHub[h.id])}</p>
                <p className="text-xs text-muted-foreground">unidades em estoque</p>
                {tByHub[h.id].count > 0 && (
                  <p className="mt-1 text-xs text-brand-600">
                    ↓ {fmtInt(tByHub[h.id].qty)} un. a receber ({tByHub[h.id].count} transf.)
                  </p>
                )}
              </Link>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Comprar agora</SectionTitle>
                <Link href="/dashboard/procurement" className="text-xs text-brand-600 hover:underline">
                  ver tudo →
                </Link>
              </div>
              <RiskTable rows={actionable.slice(0, 8)} today={snap.today} skuHref={skuHref} kind="purchase" />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Próximas rupturas (≤30d)</SectionTitle>
                <Link href="/dashboard/projection" className="text-xs text-brand-600 hover:underline">
                  projeção →
                </Link>
              </div>
              <RiskTable rows={stockouts.slice(0, 8)} today={snap.today} skuHref={skuHref} kind="stockout" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RiskTable({
  rows,
  skuHref,
  kind,
}: {
  rows: import('@/types/planning').PurchaseSuggestion[];
  today: string;
  skuHref: (s: string) => string;
  kind: 'purchase' | 'stockout';
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nada por aqui" hint="Nenhum SKU nesta condição." />;
  }
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">{kind === 'purchase' ? 'Qtd' : 'Ruptura'}</th>
            <th className="px-3 py-2 text-right font-medium">{kind === 'purchase' ? 'Comprar até' : 'Estoque'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/5">
          {rows.map((p) => (
            <tr key={p.skuBase} className="hover:bg-muted/40">
              <td className="px-3 py-2">
                <Link href={skuHref(p.skuBase)} className="font-medium text-foreground hover:text-brand-600">
                  {p.skuName}
                </Link>
                <div className="text-[11px] text-muted-foreground">{p.skuBase}</div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <StatusPill status={p.status} />
                  {p.isLate && <LatePill />}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {kind === 'purchase' ? fmtInt(p.orderQty) : fmtDate(p.stockoutDate)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {kind === 'purchase' ? fmtDate(p.buyByDate) : fmtInt(p.onHand)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
