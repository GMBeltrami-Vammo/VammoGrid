'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { HubId } from '@/types/planning';
import type { PoArrival, SkuProjections } from '@/lib/planning/projection';
import { KpiCard } from './ui';
import { InfoHint } from '@/components/planning/InfoHint';

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
  suggestion,
  arrivals,
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
  /** Projected stock WITH the suggested order(s) — yellow overlay (global/Osasco). */
  suggestion?: SkuProjections | null;
  /** Open-PO arrivals (global/Osasco only). */
  arrivals?: PoArrival[] | null;
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
  const isGlobalOrOsasco = scope === 'global' || scope === 'osasco';
  const showRecoveryOverlay = !!baseProj && isGlobalOrOsasco;
  const sugProj = suggestion && isGlobalOrOsasco
    ? scope === 'global' ? suggestion.global : suggestion.byHub[scope]
    : null;

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
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Estoque atual <InfoHint id="onhand" /></span>}
              value={fmtInt(proj.currentStock)}
            />
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Consumo diário <InfoHint id="daily-demand" /></span>}
              value={fmtNum(proj.dailyDemand)}
              hint="un/dia (méd. 30d)"
            />
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Cobertura <InfoHint id="doh" /></span>}
              value={proj.dohNow != null ? `${fmtInt(proj.dohNow)}d` : '—'}
            />
            <KpiCard
              label={<span className="inline-flex items-center gap-1">Ruptura prevista <InfoHint id="stockout-date" /></span>}
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
                    <span className="inline-flex items-center gap-1">
                      Em {d} dias <InfoHint id="projection-line" />
                    </span>
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
              suggestionTimeline={sugProj?.timeline}
              arrivals={isGlobalOrOsasco ? arrivals : undefined}
              stockoutDate={proj.stockoutDate}
              history={scopeHistory}
              height={340}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              {scopeHistory && scopeHistory.length > 0 ? 'Antes de "hoje" = histórico real. ' : ''}
              {showRecoveryOverlay ? (
                <>
                  Linha sólida = com recuperação (recondicionados entram em Osasco/global).{' '}
                  <InfoHint id="recovery-line" /> Tracejada cinza = sem recuperação.{' '}
                </>
              ) : (
                ''
              )}
              {isGlobalOrOsasco ? (
                <>
                  Linha verde tracejada = chegada de pedido (VO + qtd). <InfoHint id="incoming" />{' '}
                </>
              ) : (
                ''
              )}
              {sugProj ? <span className="text-[#f59e0b]">Linha amarela = estoque com o pedido sugerido (aéreo + marítimo). </span> : ''}
              Faixa azul = banda lo–hi da previsão. <InfoHint id="band" /> Faixa cinza (após o “limite
              do modelo”, ~90d) = extrapolação, menos confiável.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Sem projeção para este SKU.</p>
      )}
    </div>
  );
}
