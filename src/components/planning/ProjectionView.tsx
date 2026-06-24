'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { HubId } from '@/types/planning';
import type { SkuProjections } from '@/lib/planning/projection';
import { KpiCard } from './ui';

// Lazy-load Recharts (bundle-dynamic-imports) — keeps it off the initial bundle.
const ProjectionChart = dynamic(
  () => import('./ProjectionChart').then((m) => ({ default: m.ProjectionChart })),
  { ssr: false, loading: () => <div className="h-[340px] animate-pulse rounded-lg bg-muted/40" /> },
);
import { fmtDate, fmtInt, fmtNum } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

type Scope = 'global' | HubId;

export function ProjectionView({
  options,
  selected,
  projections,
  baseline,
  history,
  scope: controlledScope,
  onScopeChange,
  hideControls,
}: {
  options: { skuBase: string; skuName: string }[];
  selected: string;
  projections: SkuProjections | null;
  /** "No recovery" projection — overlaid as a reference line on global/Osasco. */
  baseline?: SkuProjections | null;
  history?: {
    global: { date: string; stock: number }[];
    byHub: Record<HubId, { date: string; stock: number }[]>;
  };
  scope?: Scope;
  onScopeChange?: (s: Scope) => void;
  hideControls?: boolean;
}) {
  const router = useRouter();
  const [localScope, setLocalScope] = useState<Scope>('global');
  const scope = controlledScope ?? localScope;
  const setScope = onScopeChange ?? setLocalScope;

  const proj = projections
    ? scope === 'global'
      ? projections.global
      : projections.byHub[scope]
    : null;

  // Reconditioning is credited to the global + Osasco streams, so the "without
  // recovery" reference line is only meaningful there.
  const baseProj = baseline
    ? scope === 'global'
      ? baseline.global
      : baseline.byHub[scope]
    : null;
  const showRecoveryOverlay = !!baseProj && (scope === 'global' || scope === 'osasco');

  const scopeHistory = history
    ? scope === 'global'
      ? history.global
      : history.byHub[scope]
    : undefined;

  const scopes: { key: Scope; label: string }[] = [
    { key: 'global', label: 'Global' },
    { key: 'osasco', label: 'Osasco' },
    { key: 'mooca', label: 'Mooca' },
    { key: 'sbc', label: 'SBC' },
  ];

  return (
    <div>
      {!hideControls && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={selected}
            onChange={(e) =>
              router.push(`/dashboard/estoque?sku=${encodeURIComponent(e.target.value)}`)
            }
            className="h-9 max-w-md flex-1 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
          >
            {options.map((o) => (
              <option key={o.skuBase} value={o.skuBase}>
                {o.skuName} ({o.skuBase})
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {scopes.map((s) => (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  scope === s.key ? 'bg-brand-500/15 text-brand-600' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {proj ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Estoque atual" value={fmtInt(proj.currentStock)} />
            <KpiCard label="Consumo diário" value={fmtNum(proj.dailyDemand)} hint="un/dia (méd. 30d)" />
            <KpiCard
              label="Cobertura"
              value={proj.dohNow != null ? `${fmtInt(proj.dohNow)}d` : '—'}
            />
            <KpiCard
              label="Ruptura prevista"
              value={fmtDate(proj.stockoutDate)}
              tone={proj.stockoutDate ? 'danger' : 'success'}
              hint={proj.incomingUnits > 0 ? `${fmtInt(proj.incomingUnits)} un. a chegar` : undefined}
            />
          </div>
          <div className="mb-4 grid grid-cols-4 gap-3">
            {[30, 60, 90, 150].map((d) => {
              const pt = proj.timeline[d];
              return (
                <div key={d} className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Em {d} dias
                  </p>
                  <p
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      pt && pt.stock === 0 ? 'text-alert-error' : 'text-foreground',
                    )}
                  >
                    {pt ? fmtInt(pt.stock) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <ProjectionChart
              timeline={proj.timeline}
              overlayTimeline={showRecoveryOverlay ? baseProj!.timeline : undefined}
              overlayLabel="Sem recuperação"
              overlayColor="var(--color-muted-foreground)"
              stockoutDate={proj.stockoutDate}
              history={scopeHistory}
              height={340}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {scopeHistory && scopeHistory.length > 0 ? 'Antes de "hoje" = histórico real. ' : ''}
              {showRecoveryOverlay
                ? 'Linha sólida = com recuperação (recondicionados entram em Osasco/global). Tracejada cinza = sem recuperação. '
                : ''}
              Ponto verde = chegada de pedido (+qtd). Faixa sombreada = banda lo–hi da previsão.
              Sombreamento após ~90d é extrapolado além do horizonte do modelo.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Sem projeção para este SKU.</p>
      )}
    </div>
  );
}
