import Link from 'next/link';
import { SkuLink } from '@/components/planning/SkuLink';
import { safeComputeSnapshot, safeComputeTransfers } from '@/lib/planning/load';
import {
  actionablePurchases,
  computeHubRisk,
  countByStatus,
  delayedShipments,
  healthScore,
  networkOnHand,
  supplyMix,
  transfersByHub,
  upcomingStockouts,
} from '@/lib/planning/selectors';
import { resolveShares } from '@/lib/planning/allocation';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { HUBS } from '@/constants/planningHubs';
import { InfoHint } from '@/components/planning/InfoHint';
import { ScopeNotice } from '@/components/planning/ScopeNotice';
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
  // Transfers are computed separately (only this page + Transferências use them);
  // both share one loadPlanningInputs fetch via React cache().
  const [snap, transfers] = await Promise.all([safeComputeSnapshot(), safeComputeTransfers()]);
  const counts = countByStatus(snap.purchases);
  const score = healthScore(snap.purchases);
  const actionable = actionablePurchases(snap.purchases);
  const stockouts = upcomingStockouts(snap.purchases, snap.today, 30);
  const toBuy = actionable.filter((p) => p.orderQty > 0);
  const buyUnits = toBuy.reduce((s, p) => s + p.orderQty, 0);
  const tByHub = transfersByHub(transfers);
  const net = networkOnHand(snap.stocks);
  const purchasesBySku = new Map(snap.purchases.map((p) => [p.skuBase, p]));
  const hubRisk = computeHubRisk({
    stocks: snap.stocks,
    forecasts: snap.forecasts,
    sharesFor: (s) => resolveShares(s, snap.shares.get(s.skuBase)),
  });
  const delayed = delayedShipments(snap.orders, purchasesBySku, snap.today);
  const mix = supplyMix({
    purchases: snap.purchases,
    forecasts: snap.forecasts,
    policies: snap.policies,
  });
  const mixTotal = mix.procurement + mix.recovery;


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
          hint={
            snap.backend === 'clickhouse'
              ? 'A seleção aplicada não corresponde a nenhum SKU com estoque. Ajuste ou limpe a seleção na aba SKUs ("Aplicar seleção ao app" — seleção vazia = catálogo inteiro).'
              : 'Configure CLICKHOUSE_HOST/USER/PASSWORD/DATABASE para carregar estoque, previsão e movimentos.'
          }
        />
      ) : (
        <>
          <ScopeNotice shown={snap.stocks.length} total={snap.catalogSize} />
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
              value={fmtInt(toBuy.length)}
              hint={`${fmtInt(buyUnits)} un a comprar`}
              tone="brand"
            />
            <KpiCard
              label="Transferências"
              value={fmtInt(transfers.length)}
              hint="próximo ciclo (terça)"
              tone="brand"
            />
          </div>

          <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Hubs por risco
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {hubRisk.map((hr) => {
              const h = HUBS[hr.hub];
              return (
                <Link
                  key={hr.hub}
                  href={`/dashboard/hub/${hr.hub}`}
                  className="block rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-brand-500/40"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{h.name}</p>
                    {hr.atRisk > 0 ? (
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-alert-error/15 text-alert-error">
                        {hr.atRisk} em risco
                      </span>
                    ) : h.isCentral ? (
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-brand-500/15 text-brand-600">
                        Central
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xl font-bold tabular-nums">{fmtInt(net.byHub[hr.hub])}</p>
                  <p className="text-xs text-muted-foreground">
                    {hr.skus} SKUs
                    {hr.worstCover != null ? ` · pior cobertura ${fmtInt(hr.worstCover)}d` : ''}
                  </p>
                  {tByHub[hr.hub].count > 0 && (
                    <p className="mt-1 text-xs text-brand-600">
                      ↓ {fmtInt(tByHub[hr.hub].qty)} un. a receber ({tByHub[hr.hub].count} transf.)
                    </p>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <SectionTitle>Origem do suprimento (próximos 150d)</SectionTitle>
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <p className="text-2xl font-bold tabular-nums text-brand-500">{fmtInt(mix.procurement)}</p>
                <p className="text-xs text-muted-foreground">un. via compras (pedidos abertos)</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-alert-success">{fmtInt(mix.recovery)}</p>
                <p className="text-xs text-muted-foreground">un. via recuperação</p>
              </div>
              <div className="text-sm text-muted-foreground">
                {mixTotal > 0
                  ? `${Math.round((100 * mix.recovery) / mixTotal)}% do suprimento previsto vem de recuperação`
                  : 'Sem suprimento previsto no horizonte'}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Comprar agora</SectionTitle>
                <Link href="/dashboard/procurement" className="text-xs text-brand-600 hover:underline">
                  ver tudo →
                </Link>
              </div>
              <RiskTable rows={actionable.slice(0, 8)} today={snap.today} kind="purchase" />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle>Próximas rupturas (≤30d)</SectionTitle>
                <Link href="/dashboard/estoque" className="text-xs text-brand-600 hover:underline">
                  estoque →
                </Link>
              </div>
              <RiskTable rows={stockouts.slice(0, 8)} today={snap.today} kind="stockout" />
            </div>
          </div>

          {delayed.length > 0 && (
            <div className="mt-6">
              <SectionTitle>Embarques atrasados ({delayed.length})</SectionTitle>
              <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">VO</th>
                      <th className="px-3 py-2 text-right font-medium">Atraso</th>
                      <th className="px-3 py-2 text-right font-medium">Qtd</th>
                      <th className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">Status SKU <InfoHint id="purchase-status" /></span>
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        <span className="inline-flex items-center justify-end gap-1">Ruptura <InfoHint id="stockout-date" /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {delayed.slice(0, 10).map((d, i) => (
                      <tr key={`${d.order.id}-${i}`} className="hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <SkuLink
                            skuBase={d.order.skuBase}
                            className="font-medium text-foreground hover:text-brand-600"
                          >
                            {d.skuName}
                          </SkuLink>
                          <div className="text-[11px] text-muted-foreground">{d.order.skuBase}</div>
                        </td>
                        <td className="px-3 py-2">{d.order.vo ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-alert-error">
                          {d.daysLate}d
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(d.order.qty)}</td>
                        <td className="px-3 py-2">
                          {d.status ? <StatusPill status={d.status} /> : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtDate(d.stockoutDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RiskTable({
  rows,
  kind,
}: {
  rows: import('@/types/planning').PurchaseSuggestion[];
  today: string;
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
            <th className="px-3 py-2 font-medium">
              <span className="inline-flex items-center gap-1">Status <InfoHint id="purchase-status" /></span>
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {kind === 'purchase' ? (
                <span className="inline-flex items-center justify-end gap-1">Qtd <InfoHint id="order-qty" /></span>
              ) : (
                <span className="inline-flex items-center justify-end gap-1">Ruptura <InfoHint id="stockout-date" /></span>
              )}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {kind === 'purchase' ? (
                <span className="inline-flex items-center justify-end gap-1">Comprar até <InfoHint id="buy-by" /></span>
              ) : (
                <span className="inline-flex items-center justify-end gap-1">Estoque <InfoHint id="onhand" /></span>
              )}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/5">
          {rows.map((p) => (
            <tr key={p.skuBase} className="hover:bg-muted/40">
              <td className="px-3 py-2">
                <SkuLink skuBase={p.skuBase} className="font-medium text-foreground hover:text-brand-600">
                  {p.skuName}
                </SkuLink>
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
