'use client';

import { useMemo, useState, useTransition } from 'react';
import type { LeadTimeSource, TransportModal } from '@/types/planning';
import { updateLeadTimePolicy } from '@/app/dashboard/lead-times/actions';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

// Editable per-SKU lead-time table (marítimo / aéreo / modal padrão). The default
// modal selects which lead time becomes the effective leadTimeDays used by the
// purchase engine (buy-by, ROP, suggested order date). Per-row save with inline
// error surfacing — mirrors the recovery editor.

export interface LeadTimeRow {
  skuBase: string;
  skuName: string;
  leadTimeSource: LeadTimeSource;
  seaDays: number;
  airDays: number;
  defaultModal: TransportModal;
  /** Lead-time std deviation (days) — combined-variance safety (B2). null = none. */
  stdDays: number | null;
  /** National vs. international purchase policy (B8). */
  isNational: boolean;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

export function LeadTimeTable({ rows }: { rows: LeadTimeRow[] }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.skuName.toLowerCase().includes(q) || r.skuBase.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-44 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filtered.length} / {rows.length} SKUs · padrão define o lead efetivo
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 text-center font-medium">Origem</th>
              <th className="px-3 py-2 text-right font-medium">Marítimo (d)</th>
              <th className="px-3 py-2 text-right font-medium">Aéreo (d)</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">σ LT (d) <InfoHint id="sigma-l" /></span>
              </th>
              <th className="px-3 py-2 text-center font-medium">Padrão</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">Efetivo <InfoHint id="lead-time" /></span>
              </th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              filtered.map((r) => <Row key={r.skuBase} row={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row }: { row: LeadTimeRow }) {
  const [sea, setSea] = useState(row.seaDays);
  const [air, setAir] = useState(row.airDays);
  const [modal, setModal] = useState<TransportModal>(row.defaultModal);
  const [std, setStd] = useState<string>(row.stdDays != null ? String(row.stdDays) : '');
  const [national, setNational] = useState(row.isNational);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const effective = modal === 'air' ? air : sea;
  const stdVal = std.trim() === '' ? null : clamp(Number(std), 0, 365);
  const dirty =
    sea !== row.seaDays ||
    air !== row.airDays ||
    modal !== row.defaultModal ||
    stdVal !== row.stdDays ||
    national !== row.isNational;

  function save() {
    setStatus('saving');
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateLeadTimePolicy(row.skuBase, {
          seaDays: sea,
          airDays: air,
          defaultModal: modal,
          stdDays: stdVal,
          isNational: national,
        });
        if (res.ok) {
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 3000);
        } else {
          setStatus('error');
          setError(res.error ?? 'Erro desconhecido');
        }
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Erro desconhecido');
      }
    });
  }

  return (
    <>
      <tr className="hover:bg-muted/20">
        <td className="px-3 py-2">
          <span className="block font-mono text-[11px] text-foreground">{row.skuBase}</span>
          <span className="block max-w-[200px] truncate text-[11px] text-muted-foreground" title={row.skuName}>
            {row.skuName}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="mx-auto flex w-fit gap-0.5 rounded-md bg-muted/60 p-0.5">
            {([false, true] as boolean[]).map((nat) => (
              <button
                key={String(nat)}
                onClick={() => setNational(nat)}
                title={nat ? 'Nacional' : 'Importado'}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  national === nat ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {nat ? 'Nac' : 'Imp'}
              </button>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="number"
            min={1}
            max={365}
            value={sea}
            onChange={(e) => setSea(clamp(Number(e.target.value), 1, 365))}
            className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="number"
            min={1}
            max={365}
            value={air}
            onChange={(e) => setAir(clamp(Number(e.target.value), 1, 365))}
            className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="number"
            min={0}
            max={365}
            value={std}
            placeholder="—"
            onChange={(e) => setStd(e.target.value)}
            className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40"
          />
        </td>
        <td className="px-3 py-2">
          <div className="mx-auto flex w-fit gap-0.5 rounded-md bg-muted/60 p-0.5">
            {(['sea', 'air'] as TransportModal[]).map((m) => (
              <button
                key={m}
                onClick={() => setModal(m)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  modal === m ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'sea' ? 'Mar' : 'Aéreo'}
              </button>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{effective}d</td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={save}
            disabled={!dirty || isPending}
            className="h-7 rounded-md bg-brand-500/15 px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'saving' ? '…' : status === 'saved' ? 'Salvo ✓' : status === 'error' ? 'Erro ✗' : 'Salvar'}
          </button>
        </td>
      </tr>
      {status === 'error' && error && (
        <tr>
          <td colSpan={8} className="px-3 pb-2">
            <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
          </td>
        </tr>
      )}
    </>
  );
}
