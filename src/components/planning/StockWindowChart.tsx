'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { HubId } from '@/types/planning';
import type { SkuProjections } from '@/lib/planning/projection';
import type { StockHistory } from '@/lib/planning/source/history';
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
  scope: controlledScope,
  onScopeChange,
}: {
  history: StockHistory;
  projections: SkuProjections;
  /** "No recovery" projection — overlaid as a reference line on global/Osasco. */
  baseline?: SkuProjections | null;
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
  const showRecoveryOverlay = !!baseProj && (scope === 'global' || scope === 'osasco');

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
        overlayTimeline={showRecoveryOverlay ? baseProj!.timeline.slice(0, 31) : undefined}
        overlayLabel="Sem recuperação"
        overlayColor="var(--color-muted-foreground)"
        stockoutDate={proj.stockoutDate}
        history={hist.length > 0 ? hist : undefined}
        height={240}
      />
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Histórico real (esquerda de &quot;hoje&quot;) · Projeção com banda lo–hi (direita)
        {showRecoveryOverlay ? ' · tracejada cinza = sem recuperação' : ''}
      </p>
    </div>
  );
}
