'use client';

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Check, Pencil } from 'lucide-react';
import { projectFleetGrowth } from '@/lib/planning/fleetGrowth';
import { upsertFleetInfo } from '@/app/dashboard/admin/actions';
import { fmtInt } from '@/lib/planning/format';

// Fleet-size chart (request #4): one line per model segment, realized (past, left of
// "hoje") + estimated (future, right), with an editable monthly growth rate per model.
// Linear: future = rate × current × dt (see projectFleetGrowth).
// Recharts is lazy-loaded via the Inner split (repo-standard next/dynamic pattern) so
// it stays off the frota route's initial bundle; the editable rate list paints at once.

const FleetGrowthChartInner = dynamic(() => import('./FleetGrowthChartInner'), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-lg bg-muted/40" />,
});

export interface FleetSegment {
  segment: string;
  currentSize: number;
  monthlyGrowthRate: number;
  asOfDate: string | null;
}

/** A REAL weekly fleet-size record (dev.fleet_size_weekly — review item 2). */
export interface FleetWeeklyActual {
  segment: string;
  weekStart: string;
  size: number;
}

const PAST_WEEKS = 12;
const FUTURE_WEEKS = 26;

export function FleetGrowthChart({
  segments,
  actuals = [],
  today,
  isHead,
}: {
  segments: FleetSegment[];
  /** Weekly REAL records; when present, the past is actuals and the projection anchors
   *  on the latest record per segment (else falls back to the retro-projection). */
  actuals?: FleetWeeklyActual[];
  today: string;
  isHead: boolean;
}) {
  const router = useRouter();

  // Per segment: real weekly points (when any) + linear projection anchored on the
  // latest real record (else on today's fleet_info size, with retro-projected past).
  const { data, keys } = useMemo(() => {
    const keys = segments.map((s) => s.segment);
    const bySegDate = new Map<string, Map<string, number>>(keys.map((k) => [k, new Map()]));
    const lastActual = new Map<string, { date: string; size: number }>();
    for (const a of actuals) {
      const m = bySegDate.get(a.segment);
      if (!m) continue; // record for a segment not configured in Admin → not charted
      const date = a.weekStart.slice(0, 10);
      m.set(date, a.size);
      const last = lastActual.get(a.segment);
      if (!last || date > last.date) lastActual.set(a.segment, { date, size: a.size });
    }
    for (const s of segments) {
      const anchor = lastActual.get(s.segment);
      const proj = projectFleetGrowth({
        base: anchor?.size ?? s.currentSize,
        monthlyGrowthRate: s.monthlyGrowthRate,
        anchor: anchor?.date ?? today,
        pastWeeks: anchor ? 0 : PAST_WEEKS,
        futureWeeks: FUTURE_WEEKS,
      });
      const m = bySegDate.get(s.segment)!;
      for (const p of proj) if (!m.has(p.date)) m.set(p.date, p.size);
    }
    const dates = [...new Set([...bySegDate.values()].flatMap((m) => [...m.keys()]))].sort();
    const data = dates.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const k of keys) {
        const v = bySegDate.get(k)!.get(date);
        if (v != null) row[k] = v;
      }
      return row;
    });
    return { data, keys };
  }, [segments, actuals, today]);

  if (segments.length === 0) {
    return (
      <p className="rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Nenhum segmento de frota. Adicione segmentos por modelo (com tamanho e taxa de crescimento) em Admin.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <FleetGrowthChartInner data={data} keys={keys} today={today} />
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        À esquerda de <b>hoje</b>: realizado ({actuals.length > 0 ? 'registros semanais reais' : 'retroprojetado — registre semanas abaixo'}) ·
        à direita: estimado — crescimento linear ancorado no último registro (futuro = taxa × frota × dt).
      </p>

      {/* Editable growth rate per model */}
      <div className="mt-4 divide-y divide-foreground/5 rounded-lg ring-1 ring-foreground/10">
        {segments.map((s) => (
          <RateRow key={s.segment} seg={s} isHead={isHead} onSaved={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}

function RateRow({ seg, isHead, onSaved }: { seg: FleetSegment; isHead: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(Math.round(seg.monthlyGrowthRate * 1000) / 10);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await upsertFleetInfo({
          segment: seg.segment,
          currentSize: seg.currentSize,
          monthlyGrowthRate: pct / 100,
          asOfDate: seg.asOfDate,
        });
        setEditing(false);
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="min-w-[8rem] font-medium">{seg.segment}</span>
      <span className="tabular-nums text-muted-foreground">{fmtInt(seg.currentSize)} motos</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Cresc./mês</span>
        {isHead && editing ? (
          <>
            <input
              type="number"
              step="0.1"
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
            />
            <span className="text-muted-foreground">%</span>
            <button onClick={save} disabled={pending} aria-label="Salvar" className="text-alert-success">
              <Check size={15} />
            </button>
          </>
        ) : (
          <>
            <span className="tabular-nums font-medium">{(seg.monthlyGrowthRate * 100).toFixed(1)}%</span>
            {isHead && (
              <button onClick={() => setEditing(true)} aria-label="Editar" className="text-muted-foreground hover:text-foreground">
                <Pencil size={13} />
              </button>
            )}
          </>
        )}
      </span>
      {error && <span className="text-xs text-alert-error">{error}</span>}
    </div>
  );
}
