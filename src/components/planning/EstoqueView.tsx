'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HubId } from '@/types/planning';
import type { SkuProjections } from '@/lib/planning/projection';
import type { StockHistory } from '@/lib/planning/source/history';
import { StockWindowChart } from './StockWindowChart';
import { ProjectionView } from './ProjectionView';
import { cn } from '@/lib/utils';

type Scope = 'global' | HubId;

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'osasco', label: 'Osasco' },
  { id: 'mooca', label: 'Mooca' },
  { id: 'sbc', label: 'SBC' },
];

export function EstoqueView({
  options,
  selected,
  projections,
  history,
}: {
  options: { skuBase: string; skuName: string }[];
  selected: string;
  projections: SkuProjections | null;
  history: StockHistory;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('global');

  return (
    <div>
      {/* Shared controls: SKU selector + scope toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
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
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                scope === s.id
                  ? 'bg-brand-500/15 text-brand-600'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart 1: D-30 → D+30 window */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Janela D-30 → D+30
      </p>
      <div className="mb-7">
        {projections ? (
          <StockWindowChart
            history={history}
            projections={projections}
            scope={scope}
            onScopeChange={setScope}
          />
        ) : (
          <div className="flex h-[260px] items-center justify-center rounded-xl bg-card ring-1 ring-foreground/10">
            <p className="text-sm text-muted-foreground">Sem dados de projeção para este SKU.</p>
          </div>
        )}
      </div>

      {/* Chart 2: D0 → D+150 full horizon */}
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Horizonte D0 → D+150
      </p>
      <ProjectionView
        options={options}
        selected={selected}
        projections={projections}
        history={history}
        scope={scope}
        onScopeChange={setScope}
        hideControls
      />
    </div>
  );
}
