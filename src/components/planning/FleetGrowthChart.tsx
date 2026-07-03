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

const PAST_WEEKS = 12;
const FUTURE_WEEKS = 26;

export function FleetGrowthChart({
  segments,
  today,
  isHead,
}: {
  segments: FleetSegment[];
  today: string;
  isHead: boolean;
}) {
  const router = useRouter();

  // Shared weekly grid (today-anchored): each week is a row; each segment a column.
  const { data, keys } = useMemo(() => {
    const keys = segments.map((s) => s.segment);
    const perSeg = new Map(
      segments.map((s) => [
        s.segment,
        projectFleetGrowth({
          base: s.currentSize,
          monthlyGrowthRate: s.monthlyGrowthRate,
          anchor: today,
          pastWeeks: PAST_WEEKS,
          futureWeeks: FUTURE_WEEKS,
        }),
      ]),
    );
    const weeks = perSeg.get(keys[0])?.map((p) => p.week) ?? [];
    const data = weeks.map((w, i) => {
      const row: Record<string, number | string> = { date: perSeg.get(keys[0])![i].date, week: w };
      for (const k of keys) row[k] = perSeg.get(k)![i].size;
      return row;
    });
    return { data, keys };
  }, [segments, today]);

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
        À esquerda de <b>hoje</b>: realizado (retroprojetado) · à direita: estimado — crescimento linear
        (futuro = taxa × frota atual × dt).
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
