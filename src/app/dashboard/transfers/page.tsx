import Link from 'next/link';
import { safeComputeSnapshot } from '@/lib/planning/load';
import { fmtDate, fmtInt, HUB_SHORT } from '@/lib/planning/format';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader } from '@/components/planning/ui';
import { TransferMap } from '@/components/planning/TransferMap';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const snap = await safeComputeSnapshot();
  const transfers = [...snap.transfers].sort((a, b) => b.qty - a.qty);
  const units = transfers.reduce((s, t) => s + t.qty, 0);
  const hubsServed = new Set(transfers.map((t) => t.toHub)).size;

  return (
    <div>
      <PageHeader
        eyebrow="Transferências"
        title="Planejamento de Transferências"
        subtitle="Ciclo semanal (terça) — distribuição hub-and-spoke a partir de Osasco para evitar rupturas"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      {snap.stocks.length === 0 ? (
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar sugestões de transferência." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <KpiCard label="Transferências sugeridas" value={fmtInt(transfers.length)} tone="brand" />
            <KpiCard label="Unidades a mover" value={fmtInt(units)} />
            <KpiCard label="Hubs atendidos" value={`${hubsServed} / 2`} />
          </div>

          <div className="mb-6">
            <TransferMap transfers={transfers} />
          </div>

          {transfers.length === 0 ? (
            <EmptyState title="Nenhuma transferência necessária" hint="Todos os hubs cobrem o próximo ciclo." />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Rota</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd</th>
                    <th className="px-3 py-2 text-right font-medium">Precisa até</th>
                    <th className="px-3 py-2 text-right font-medium">Confiança</th>
                    <th className="px-3 py-2 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/5">
                  {transfers.map((t, i) => (
                    <tr key={`${t.skuBase}-${t.toHub}-${i}`} className="align-top hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/sku/${encodeURIComponent(t.skuBase)}`}
                          className="font-medium text-foreground hover:text-brand-600"
                        >
                          {t.skuName}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">{t.skuBase}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{HUB_SHORT[t.fromHub]}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{HUB_SHORT[t.toHub]}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtInt(t.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDate(t.needByDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(t.confidence * 100)}%</td>
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
