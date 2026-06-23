import Link from 'next/link';
import { loadPlanningInputs } from '@/lib/planning/load';
import { resolveShares } from '@/lib/planning/allocation';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { purchaseForSku } from '@/lib/planning/purchase';
import { projectSku } from '@/lib/planning/projection';
import { HUB_LIST } from '@/constants/planningHubs';
import { fmtBRL, fmtDate, fmtInt, fmtNum } from '@/lib/planning/format';
import {
  EmptyState,
  FreshnessBanner,
  KpiCard,
  LatePill,
  PageHeader,
  SectionTitle,
  StatusPill,
} from '@/components/planning/ui';
import { SkuSimulator } from '@/components/planning/SkuSimulator';

export const dynamic = 'force-dynamic';

export default async function SkuDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const skuBase = decodeURIComponent(sku);
  const inputs = await loadPlanningInputs();
  const stock = inputs.stocks.find((s) => s.skuBase === skuBase);

  if (!stock) {
    return (
      <div>
        <PageHeader eyebrow="SKU" title={skuBase} />
        <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />
        <EmptyState title="SKU não encontrado" hint="Sem estoque para este sku_base na fonte atual." />
      </div>
    );
  }

  const forecast = inputs.forecasts.get(skuBase) ?? null;
  const orders = inputs.ordersBySku.get(skuBase) ?? [];
  const policy =
    inputs.policies.get(skuBase) ??
    defaultPolicyFor(skuBase, stock, forecast?.abcClass ?? 'C', inputs.today);
  const shares = resolveShares(stock, inputs.shares.get(skuBase));

  const purchase = purchaseForSku({
    skuBase,
    skuName: stock.skuName,
    forecast,
    stock,
    orders,
    policy,
    today: inputs.today,
  });
  const projections = projectSku({ stock, forecast, orders, policy, shares, today: inputs.today });

  return (
    <div>
      <div className="mb-1">
        <Link href="/dashboard/procurement" className="text-xs text-brand-600 hover:underline">
          ← Compras
        </Link>
      </div>
      <PageHeader
        eyebrow={`${skuBase} · classe ${policy.abcClass} · lead ${policy.leadTimeDays}d (${policy.leadTimeSource === 'national-file' ? 'nacional' : policy.leadTimeSource === 'manual' ? 'manual' : 'internacional'})`}
        title={stock.skuName}
        subtitle={stock.isRepairable ? 'Peça recuperável (reconditioning)' : 'Peça não recuperável'}
      />
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      {/* Per-hub stock */}
      <SectionTitle>Estoque por hub</SectionTitle>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total" value={fmtInt(stock.total)} tone="brand" />
        {HUB_LIST.map((h) => (
          <KpiCard
            key={h.id}
            label={h.name}
            value={fmtInt(stock.byHub[h.id])}
            hint={
              projections.byHub[h.id].stockoutDate
                ? `ruptura ${fmtDate(projections.byHub[h.id].stockoutDate)}`
                : 'sem ruptura'
            }
            tone={projections.byHub[h.id].stockoutDate ? 'danger' : 'default'}
          />
        ))}
      </div>

      {/* Purchase recommendation */}
      <SectionTitle>Recomendação de compra</SectionTitle>
      <div className="mb-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-3 flex items-center gap-2">
          <StatusPill status={purchase.status} />
          {purchase.isLate && <LatePill />}
          <span className="text-sm text-muted-foreground">{purchase.reasoning}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Ponto recompra" value={fmtInt(purchase.rop)} />
          <Metric label="Estoque segurança" value={fmtInt(purchase.safetyStock)} />
          <Metric label="Demanda no lead" value={fmtInt(purchase.expectedLeadTimeDemand)} />
          <Metric label="Comprar (qtd)" value={purchase.orderQty > 0 ? fmtInt(purchase.orderQty) : '—'} />
          <Metric label="Comprar até" value={fmtDate(purchase.buyByDate)} />
          <Metric
            label="Custo estimado"
            value={purchase.estCost != null && purchase.orderQty > 0 ? fmtBRL(purchase.estCost) : '—'}
          />
        </div>
      </div>

      {/* Simulator */}
      <SectionTitle>Simular compra (what-if)</SectionTitle>
      <div className="mb-6">
        <SkuSimulator
          stock={stock}
          forecast={forecast}
          orders={orders}
          policy={policy}
          shares={shares}
          today={inputs.today}
        />
      </div>

      {/* Open orders + recovery */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Pedidos em aberto</SectionTitle>
          {orders.length === 0 ? (
            <EmptyState title="Nenhum pedido em aberto" />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">VO</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd</th>
                    <th className="px-3 py-2 text-right font-medium">ETA</th>
                    <th className="px-3 py-2 font-medium">Modal</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/5">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">{o.vo ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(o.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDate(o.eta)}</td>
                      <td className="px-3 py-2">{o.modal === 'air' ? 'Aéreo' : o.modal === 'sea' ? 'Marítimo' : '—'}</td>
                      <td className="px-3 py-2">{o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <SectionTitle>Recuperação</SectionTitle>
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            {stock.isRepairable ? (
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Taxa de recuperação" value={`${Math.round(policy.recoveryRate * 100)}%`} />
                <Metric label="Turnaround" value={`${policy.recoveryTurnaroundDays}d`} />
                <p className="col-span-2 text-xs text-muted-foreground">
                  Peças consumidas retornam a Osasco como estoque recuperado após o turnaround,
                  proporcional ao consumo previsto. Editável em Admin.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Peça não recuperável — sem pipeline de recuperação.</p>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <KpiCard label="Consumo diário (global)" value={fmtNum(projections.global.dailyDemand)} hint="un/dia" />
            <KpiCard
              label="Cobertura atual"
              value={projections.global.dohNow != null ? `${fmtInt(projections.global.dohNow)}d` : '—'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
