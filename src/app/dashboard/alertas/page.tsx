import Link from 'next/link';
import { loadPlanningInputs } from '@/lib/planning/load';
import { EmptyState, FreshnessBanner, KpiCard, PageHeader, SeverityPill } from '@/components/planning/ui';
import { fmtInt } from '@/lib/planning/format';
import type { AlertCode, PlanningAlert } from '@/types/planning';

export const dynamic = 'force-dynamic';

const CODE_LABEL: Record<AlertCode, string> = {
  STK_RUPTURE: 'Ruptura prevista',
  STK_BELOW_ROP: 'Abaixo do ponto de recompra',
  STK_BELOW_SS: 'Abaixo do estoque de segurança',
  DEM_TREND_UP: 'Demanda em alta',
  DEM_VARIABILITY: 'Demanda volátil',
  STK_OBSOLETE: 'Possível obsolescência',
};

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export default async function AlertsPage() {
  const inputs = await loadPlanningInputs();
  const alerts = [...inputs.alerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const byCode = new Map<AlertCode, PlanningAlert[]>();
  for (const a of alerts) {
    const list = byCode.get(a.code);
    if (list) list.push(a);
    else byCode.set(a.code, [a]);
  }
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const warning = alerts.filter((a) => a.severity === 'warning').length;

  return (
    <div>
      <PageHeader
        eyebrow="Sistema"
        title="Alertas"
        subtitle="Cobertura e demanda do pipeline S&OP (dev.sop_alerts), por código de alerta"
      />
      <FreshnessBanner asOfDate={inputs.asOfDate} backend={inputs.backend} />

      {alerts.length === 0 ? (
        <EmptyState title="Nenhum alerta" hint="Sem alertas no último ciclo do S&OP (ou fonte não configurada)." />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <KpiCard label="Total" value={fmtInt(alerts.length)} />
            <KpiCard label="Críticos" value={fmtInt(critical)} tone="danger" />
            <KpiCard label="Atenção" value={fmtInt(warning)} tone="warning" />
          </div>

          <div className="space-y-6">
            {[...byCode.entries()].map(([code, list]) => (
              <div key={code}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{CODE_LABEL[code]}</h2>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Severidade</th>
                        <th className="px-3 py-2 font-medium">Motivo</th>
                        <th className="px-3 py-2 text-right font-medium">Cobertura</th>
                        <th className="px-3 py-2 text-right font-medium">Estoque</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/5">
                      {list.slice(0, 50).map((a, i) => (
                        <tr key={`${a.skuBase}-${i}`} className="align-top hover:bg-muted/40">
                          <td className="px-3 py-2">
                            <Link
                              prefetch={false}
                              href={`/dashboard/estoque?sku=${encodeURIComponent(a.skuBase)}`}
                              className="font-medium text-foreground hover:text-brand-600"
                            >
                              {a.skuName}
                            </Link>
                            <div className="text-[11px] text-muted-foreground">{a.skuBase}</div>
                          </td>
                          <td className="px-3 py-2">
                            <SeverityPill severity={a.severity} />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{a.reason}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {a.metrics.cover != null ? `${fmtInt(a.metrics.cover)}d` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {a.metrics.OH != null ? fmtInt(a.metrics.OH) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
