import { SkuLink } from '@/components/planning/SkuLink';
import { safeComputeSnapshot, safeComputeTransfers } from '@/lib/planning/load';
import { isFilterActive } from '@/lib/planning/filter';
import { fmtDate, fmtInt, HUB_SHORT } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { TransferMap } from '@/components/planning/TransferMap';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  // Transfers are computed separately from the snapshot (shared loadPlanningInputs).
  const [snap, allTransfers] = await Promise.all([safeComputeSnapshot(), safeComputeTransfers()]);
  const cycle1 = allTransfers.filter((t) => t.cycle === 1).sort((a, b) => b.qty - a.qty);
  const cycle2 = allTransfers.filter((t) => t.cycle === 2).sort((a, b) => b.qty - a.qty);
  const transfers = [...cycle1, ...cycle2];
  const unitsC1 = cycle1.reduce((s, t) => s + t.qty, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Transferências"
        title="Planejamento de Transferências"
        subtitle="Dois ciclos semanais (terça) — distribuição hub-and-spoke a partir de Osasco. Ciclo 2 parte do estoque projetado após o Ciclo 1."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {snap.stocks.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar sugestões de transferência." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <KpiCard label="Ciclo 1 · esta semana" value={fmtInt(cycle1.length)} tone="brand" hint={`${fmtInt(unitsC1)} un a mover`} />
            <KpiCard label="Ciclo 2 · próxima semana" value={fmtInt(cycle2.length)} hint="estoque projetado pós-ciclo 1" />
            <KpiCard label="Total sugerido" value={fmtInt(transfers.length)} />
          </div>

          <div className="mb-6">
            <TransferMap transfers={cycle1} />
          </div>

          {transfers.length === 0 ? (
            isFilterActive(snap.filter) ? (
              <EmptyState
                title="Nenhuma transferência no recorte atual"
                hint="Há uma seleção de SKUs ativa limitando a análise. Limpe a seleção (chip no topo ou na aba SKUs) para avaliar a rede inteira."
              />
            ) : (
              <EmptyState title="Nenhuma transferência necessária" hint="Todos os hubs cobrem o próximo ciclo." />
            )
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Ciclo</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1">Rota <InfoHint id="transfer-route" /></span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">Qtd <InfoHint id="transfer-qty" /></span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">Precisa até <InfoHint id="transfer-need" /></span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center justify-end gap-1">Confiança <InfoHint id="transfer-confidence" /></span>
                    </th>
                    <th className="px-3 py-2 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/5">
                  {transfers.map((t, i) => (
                    <tr key={`${t.skuBase}-${t.toHub}-${t.cycle}-${i}`} className="align-top hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            t.cycle === 1
                              ? 'bg-brand-500/15 text-brand-600'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {t.cycle === 1 ? 'Sem 1' : 'Sem 2'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <SkuLink
                          skuBase={t.skuBase}
                          className="font-medium text-foreground hover:text-brand-600"
                        >
                          {t.skuName}
                        </SkuLink>
                        <div className="text-[11px] text-muted-foreground">{t.skuBase}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{HUB_SHORT[t.fromHub]}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{HUB_SHORT[t.toHub]}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtInt(t.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDate(t.needByDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-medium">{Math.round(t.confidence * 100)}%</span>
                        <div className="text-[10px] font-normal text-muted-foreground">
                          prec {Math.round(t.precision * 100)}% · fresc {Math.round(t.freshness * 100)}%
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
