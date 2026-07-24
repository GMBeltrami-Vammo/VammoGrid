'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, Trash2 } from 'lucide-react';
import { DateField } from '@/components/ui/DateField';
import { deleteWeeklySize, setMonthEndSize, upsertWeeklySize } from '@/app/dashboard/frota/actions';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

// Weekly REAL fleet-size ledger (review item 2): register week-by-week per model —
// the Comercial team's format — or use the end-of-month shortcut, which interpolates
// the month homogeneously from the last known record.

export interface WeeklyRow {
  segment: string;
  weekStart: string;
  size: number;
}

const INPUT =
  'h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500';

export function FleetWeeklyPanel({
  segments,
  rows,
  isHead,
  today,
}: {
  segments: string[];
  rows: WeeklyRow[];
  isHead: boolean;
  today: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Register-a-week form.
  const [wSegment, setWSegment] = useState(segments[0] ?? '');
  const [wDate, setWDate] = useState(today);
  const [wSize, setWSize] = useState('');

  // End-of-month shortcut form.
  const [mSegment, setMSegment] = useState(segments[0] ?? '');
  const [mDate, setMDate] = useState(today);
  const [mSize, setMSize] = useState('');
  const [mInfo, setMInfo] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: (r: { ok: boolean } & Record<string, unknown>) => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Erro ao salvar.');
      else {
        after?.(res as { ok: boolean } & Record<string, unknown>);
        router.refresh();
      }
    });
  };

  const bySegment = new Map<string, WeeklyRow[]>();
  for (const r of rows) {
    (bySegment.get(r.segment) ?? bySegment.set(r.segment, []).get(r.segment)!).push(r);
  }

  return (
    <div className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pontos de controle da frota
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        Cada ponto é (data, frota real) por modelo. O gráfico interpola linearmente entre pontos,
        mantém constante antes do primeiro e projeta o crescimento após o último. Registre semana a
        semana (reinformar a mesma data atualiza o ponto) ou use o fim de mês, que distribui
        homogeneamente entre o último ponto e a data informada.
      </p>

      {error && <p className="mb-3 rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>}
      {mInfo && <p className="mb-3 rounded-md bg-alert-success/10 px-3 py-2 text-sm text-alert-success">{mInfo}</p>}

      {isHead && segments.length > 0 && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          {/* Weekly form */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Registrar semana</p>
            <div className="flex flex-wrap items-end gap-2">
              <select value={wSegment} onChange={(e) => setWSegment(e.target.value)} className={cn(INPUT, 'w-32')}>
                {segments.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <DateField value={wDate} onChange={setWDate} className="h-8 w-32" aria-label="Semana" />
              <input
                type="number"
                min={0}
                value={wSize}
                onChange={(e) => setWSize(e.target.value)}
                placeholder="Frota"
                className={cn(INPUT, 'w-24 text-right tabular-nums')}
              />
              <button
                onClick={() => run(() => upsertWeeklySize(wSegment, wDate, Number(wSize)), () => setWSize(''))}
                disabled={pending || !wSize}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50"
              >
                <Check size={13} /> Salvar
              </button>
            </div>
          </div>

          {/* Month-end shortcut */}
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Informar fim de mês (distribui pelo mês)
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <select value={mSegment} onChange={(e) => setMSegment(e.target.value)} className={cn(INPUT, 'w-32')}>
                {segments.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <DateField value={mDate} onChange={setMDate} className="h-8 w-32" aria-label="Fim do mês" />
              <input
                type="number"
                min={0}
                value={mSize}
                onChange={(e) => setMSize(e.target.value)}
                placeholder="Frota"
                className={cn(INPUT, 'w-24 text-right tabular-nums')}
              />
              <button
                onClick={() =>
                  run(
                    () => setMonthEndSize(mSegment, mDate, Number(mSize)),
                    (r) => {
                      setMSize('');
                      setMInfo(`Distribuído em ${String(r.weeksWritten ?? '?')} semana(s).`);
                    },
                  )
                }
                disabled={pending || !mSize}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50"
              >
                <CalendarDays size={13} /> Distribuir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent records per segment */}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum ponto de controle ainda — o gráfico usa o tamanho atual do fleet_info como ponto único (constante antes, crescimento depois).</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...bySegment.entries()].map(([seg, list]) => (
            <div key={seg} className="rounded-lg ring-1 ring-foreground/10">
              <p className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">{seg}</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-foreground/5">
                  {[...list].reverse().map((r) => (
                    <tr key={r.weekStart} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 tabular-nums text-xs text-muted-foreground">{fmtDate(r.weekStart)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(r.size)} motos</td>
                      {isHead && (
                        <td className="w-8 px-2 py-1.5 text-right">
                          <button
                            onClick={() => run(() => deleteWeeklySize(seg, r.weekStart))}
                            disabled={pending}
                            aria-label="Remover registro"
                            className="text-muted-foreground hover:text-alert-error"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
