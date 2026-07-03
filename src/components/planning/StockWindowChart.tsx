'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { HubId } from '@/types/planning';
import type { PoArrival, SkuProjections } from '@/lib/planning/projection';
import type { StockHistory } from '@/lib/planning/source/history';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

// D-30→D+30 focused stock window. Joins real history (left) to projection (right)
// with a "hoje" divider. Scope toggle lets the user see global vs per-hub.

const ProjectionChart = dynamic(
  () => import('./ProjectionChart').then((m) => ({ default: m.ProjectionChart })),
  { ssr: false, loading: () => <div className="h-[240px] animate-pulse rounded-lg bg-muted/40" /> },
);

type Scope = 'global' | HubId;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'osasco', label: 'Osasco' },
  { id: 'mooca', label: 'Mooca' },
  { id: 'sbc', label: 'SBC' },
];

export function StockWindowChart({
  history,
  projections,
  baseline,
  suggestion,
  arrivals,
  scope: controlledScope,
  onScopeChange,
}: {
  history: StockHistory;
  projections: SkuProjections;
  /** "No recovery" projection — overlaid as a reference line on global/Osasco. */
  baseline?: SkuProjections | null;
  /** Projected stock WITH the suggested order(s) — yellow overlay (global/Osasco). */
  suggestion?: SkuProjections | null;
  /** Open-PO arrivals (global/Osasco only). */
  arrivals?: PoArrival[] | null;
  scope?: Scope;
  onScopeChange?: (s: Scope) => void;
}) {
  const [localScope, setLocalScope] = useState<Scope>('global');
  const scope = controlledScope ?? localScope;
  const setScope = onScopeChange ?? setLocalScope;
  const isControlled = controlledScope !== undefined;

  const proj = scope === 'global' ? projections.global : projections.byHub[scope as HubId];
  const hist = scope === 'global' ? history.global : (history.byHub[scope as HubId] ?? []);

  // Slice projection to 31 points (D0→D+30) so the chart stays in the ±30d window
  const timeline30 = proj.timeline.slice(0, 31);

  // Reconditioning is credited to the global + Osasco streams only, so the
  // "without recovery" reference line is meaningful only there.
  const baseProj = baseline
    ? scope === 'global'
      ? baseline.global
      : baseline.byHub[scope as HubId]
    : null;
  const isGlobalOrOsasco = scope === 'global' || scope === 'osasco';
  const showRecoveryOverlay = !!baseProj && isGlobalOrOsasco;
  // Suggested-order projection lands POs at Osasco → meaningful on global + Osasco only.
  const sugProj = suggestion && isGlobalOrOsasco
    ? scope === 'global' ? suggestion.global : suggestion.byHub[scope as HubId]
    : null;

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Janela D-30 → D+30
        </p>
        {!isControlled && (
          <div className="flex gap-1">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                  scope === s.id
                    ? 'bg-brand-500/20 text-brand-600'
                    : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <ProjectionChart
        timeline={timeline30}
        rateSource={proj.timeline}
        overlayTimeline={showRecoveryOverlay ? baseProj!.timeline.slice(0, 31) : undefined}
        overlayLabel="Sem recuperação"
        overlayColor="var(--color-muted-foreground)"
        suggestionTimeline={sugProj ? sugProj.timeline.slice(0, 31) : undefined}
        arrivals={isGlobalOrOsasco ? arrivals : undefined}
        stockoutDate={proj.stockoutDate}
        history={hist.length > 0 ? hist : undefined}
        height={240}
      />
      <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-1 text-[10px] text-muted-foreground">
        Histórico real (esquerda de &quot;hoje&quot;) · Projeção <InfoHint id="projection-line" /> com
        banda lo–hi <InfoHint id="band" /> (direita)
        {isGlobalOrOsasco ? (
          <>
            {' · linha verde = chegada de pedido (VO)'} <InfoHint id="incoming" />
          </>
        ) : (
          ''
        )}
        {showRecoveryOverlay ? (
          <>
            {' · tracejada cinza = sem recuperação'} <InfoHint id="recovery-line" />
          </>
        ) : (
          ''
        )}
        {proj.timeline.some((p) => p.backlog > 0) ? (
          <span className="text-alert-error"> · vermelha tracejada = demanda acum. não fornecida</span>
        ) : (
          ''
        )}
      </p>
    </div>
  );
}
