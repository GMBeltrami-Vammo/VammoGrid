'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, X } from 'lucide-react';
import { SCENARIO_COOKIE, type PlanningScenario } from '@/lib/planning/scenario';
import { cn } from '@/lib/utils';

// Portfolio-wide what-if controls. Persists to the vg:scenario cookie and refreshes;
// the server recomputes the whole app under the scenario (read-only — production
// data is untouched).

const DEMAND_OPTIONS = [-20, -10, 0, 10, 20, 50];

export function ScenarioBar({ initial }: { initial: PlanningScenario }) {
  const router = useRouter();
  const [demandPct, setDemandPct] = useState(initial.demandPct);
  const [poDelayDays, setPoDelayDays] = useState(initial.poDelayDays);
  const active = demandPct !== 0 || poDelayDays !== 0;

  function apply(next: PlanningScenario) {
    // eslint-disable-next-line react-hooks/immutability -- event-handler side effect
    document.cookie = `${SCENARIO_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000`;
    router.refresh();
  }
  const setDemand = (v: number) => {
    setDemandPct(v);
    apply({ demandPct: v, poDelayDays });
  };
  const reset = () => {
    setDemandPct(0);
    setPoDelayDays(0);
    apply({ demandPct: 0, poDelayDays: 0 });
  };

  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-2 rounded-xl p-2 ring-1',
        active ? 'bg-alert-warning/10 ring-alert-warning/40' : 'bg-card ring-foreground/10',
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <FlaskConical size={14} /> Cenário
      </span>
      <span className="text-xs text-muted-foreground">Demanda</span>
      <div className="flex gap-1">
        {DEMAND_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDemand(d)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              demandPct === d ? 'bg-brand-500/15 text-brand-600' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {d > 0 ? `+${d}` : d}%
          </button>
        ))}
      </div>
      <span className="ml-2 text-xs text-muted-foreground">Atraso pedidos</span>
      <input
        type="number"
        value={poDelayDays}
        onChange={(e) => setPoDelayDays(Number(e.target.value) || 0)}
        onBlur={() => apply({ demandPct, poDelayDays })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply({ demandPct, poDelayDays });
        }}
        className="h-7 w-16 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
      />
      <span className="text-xs text-muted-foreground">dias</span>

      {active && (
        <>
          <span className="ml-2 text-xs font-medium text-[color:var(--color-alert-warning)]">
            Simulação ativa — não afeta dados de produção
          </span>
          <button
            onClick={reset}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X size={12} /> Limpar
          </button>
        </>
      )}
    </div>
  );
}
