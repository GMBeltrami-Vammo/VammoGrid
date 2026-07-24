'use client';

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Check, Pencil } from 'lucide-react';
import { fleetSizeOn, netMonthlyGrowthRate, type FleetControlPoint } from '@/lib/planning/fleetGrowth';
import { addDays } from '@/lib/planning/dates';
import { upsertFleetInfo } from '@/app/dashboard/admin/actions';
import { fmtInt } from '@/lib/planning/format';

// Fleet-size chart (request #4 / Feature B): one line per model segment built from
// editable CONTROL POINTS (decisions.MD #34) — realized past = piecewise-linear
// interpolation between points (constant before the first), future = linear growth off
// the last point, with an editable monthly growth rate per model.
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
  /** Meta comercial (fração da frota/mês); quando presente com churn, substitui a taxa. */
  commercialTargetPct: number | null;
  /** Churn (fração da frota/mês). */
  churnPct: number | null;
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

  // Per segment: a CONTROL-POINT curve (decisions.MD #34) — the real weekly records are
  // control points; the past is piecewise-linear interpolation between them (CONSTANT
  // before the first, no retro-projection), the future is linear growth off the last.
  // A segment with no records falls back to a single synthetic point at fleet_info's
  // as_of/current size. Sampled on the weekly grid around "hoje" ∪ the real point dates
  // (so the real vertices land exactly, with interpolation/growth between them).
  const { data, keys } = useMemo(() => {
    const keys = segments.map((s) => s.segment);
    const cpBySeg = new Map<string, FleetControlPoint[]>(keys.map((k) => [k, []]));
    for (const a of actuals) {
      const arr = cpBySeg.get(a.segment);
      if (!arr) continue; // record for a segment not configured in Admin → not charted
      arr.push({ date: a.weekStart.slice(0, 10), size: a.size });
    }
    for (const s of segments) {
      const arr = cpBySeg.get(s.segment)!;
      if (arr.length === 0) arr.push({ date: (s.asOfDate ?? today).slice(0, 10), size: s.currentSize });
    }
    const from = addDays(today, -PAST_WEEKS * 7);
    const to = addDays(today, FUTURE_WEEKS * 7);
    const dateSet = new Set<string>();
    for (let w = -PAST_WEEKS; w <= FUTURE_WEEKS; w++) dateSet.add(addDays(today, w * 7));
    for (const arr of cpBySeg.values()) {
      for (const cp of arr) if (cp.date >= from && cp.date <= to) dateSet.add(cp.date);
    }
    const dates = [...dateSet].sort();
    const data = dates.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const s of segments) {
        // net = meta − churn quando informados; senão a taxa manual.
        row[s.segment] = fleetSizeOn(cpBySeg.get(s.segment)!, netMonthlyGrowthRate(s), date);
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
        Pontos de controle {actuals.length > 0 ? '(registros semanais reais)' : '(nenhum registro — usando o tamanho atual do fleet_info)'}:
        passado = interpolação linear entre pontos, constante antes do primeiro; futuro = crescimento linear a partir do último ponto (taxa × frota × dt).
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

  // Meta/churn (editadas no Admin) sobrepõem a taxa manual quando presentes.
  const usesMetaChurn = seg.commercialTargetPct != null || seg.churnPct != null;
  const netPct = netMonthlyGrowthRate(seg) * 100;

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="min-w-[8rem] font-medium">{seg.segment}</span>
      <span className="tabular-nums text-muted-foreground">{fmtInt(seg.currentSize)} motos</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Cresc./mês</span>
        {usesMetaChurn ? (
          // net = meta − churn; taxa manual ignorada. Editar meta/churn em Admin.
          <span
            className="tabular-nums font-medium"
            title={`Meta ${((seg.commercialTargetPct ?? 0) * 100).toFixed(1)}% − churn ${((seg.churnPct ?? 0) * 100).toFixed(1)}% (editar em Admin)`}
          >
            {netPct.toFixed(1)}%
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              (meta {((seg.commercialTargetPct ?? 0) * 100).toFixed(1)}% − churn {((seg.churnPct ?? 0) * 100).toFixed(1)}%)
            </span>
          </span>
        ) : isHead && editing ? (
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
