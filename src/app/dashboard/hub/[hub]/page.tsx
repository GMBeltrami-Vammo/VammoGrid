import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadPlanningInputs } from '@/lib/planning/load';
import { resolveShares } from '@/lib/planning/allocation';
import { HUBS, HUB_IDS } from '@/constants/planningHubs';
import { fmtInt, fmtNum } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { cn } from '@/lib/utils';
import type { HubId } from '@/types/planning';

export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<string, string> = {
  BIKE: 'Moto',
  BATTERY: 'Bateria',
  BOX: 'Baú',
};

function avgDaily(points: { yhat: number }[] | undefined, n = 30): number {
  if (!points || points.length === 0) return 0;
  const slice = points.slice(0, n);
  return slice.reduce((s, p) => s + p.yhat, 0) / slice.length;
}

export default async function HubPage({ params }: { params: Promise<{ hub: string }> }) {
  const { hub } = await params;
  if (!HUB_IDS.includes(hub as HubId)) notFound();
  const hubId = hub as HubId;
  const inputs = await loadPlanningInputs();

  const rows = inputs.stocks
    .map((s) => {
      const fc = inputs.forecasts.get(s.skuBase);
      const share = resolveShares(s, inputs.shares.get(s.skuBase))[hubId];
      const hubDaily = avgDaily(fc?.points) * share;
      const onHand = s.byHub[hubId] ?? 0;
      const cover = hubDaily > 0 ? onHand / hubDaily : null;
      return { s, onHand, hubDaily, cover };
    })
    .filter((r) => r.onHand > 0 || r.hubDaily > 0)
    .sort((a, b) => (a.cover ?? Infinity) - (b.cover ?? Infinity));

  const totalUnits = rows.reduce((acc, r) => acc + r.onHand, 0);
  const atRisk = rows.filter((r) => r.cover != null && r.cover < 14).length;

  return (
    <div>
      <div className="mb-1">
        <Link href="/dashboard" className="text-xs text-brand-600 hover:underline">
          ← Visão Geral
        </Link>
      </div>
      <PageHeader
        eyebrow={HUBS[hubId].isCentral ? 'Hub central' : 'Hub'}
        title={HUBS[hubId].name}
        subtitle="Itens em estoque neste hub — clique em um item para ver o gráfico (histórico + projeção)"
      />
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      {rows.length === 0 ? (
        <EmptyState title="Sem itens" hint="Nenhum item com estoque ou consumo neste hub (ou filtro ativo)." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <KpiCard label="SKUs no hub" value={fmtInt(rows.length)} />
            <KpiCard label="Unidades" value={fmtInt(totalUnits)} />
            <KpiCard label="Em risco (< 14d)" value={fmtInt(atRisk)} tone={atRisk > 0 ? 'danger' : 'success'} />
          </div>

          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2 text-right font-medium">Estoque</th>
                  <th className="px-3 py-2 text-right font-medium">Consumo/dia</th>
                  <th className="px-3 py-2 text-right font-medium">Cobertura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.s.skuBase} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(r.s.skuBase)}`}
                        className="font-medium text-foreground hover:text-brand-600"
                      >
                        {r.s.skuName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{r.s.skuBase}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.s.category ? (CATEGORY_LABEL[r.s.category] ?? r.s.category) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.onHand)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.hubDaily)}</td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-medium tabular-nums',
                        r.cover != null && r.cover < 7
                          ? 'text-alert-error'
                          : r.cover != null && r.cover < 14
                            ? 'text-[color:var(--color-alert-warning)]'
                            : 'text-foreground',
                      )}
                    >
                      {r.cover != null ? `${fmtInt(r.cover)}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 300 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando 300 de {fmtInt(rows.length)} itens — use o filtro acima para refinar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
