'use client';

import { useMemo, useState, useTransition } from 'react';
import type { LeadTimeSource, TransportModal } from '@/types/planning';
import { updateLeadTimePolicy } from '@/app/dashboard/semanas/actions';
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
}

const SOURCE_LABEL: Record<LeadTimeSource, string> = {
  'national-file': 'Nacional',
  'international-default': 'Importado',
  manual: 'Manual',
};

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
              <th className="px-3 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 text-right font-medium">Marítimo (d)</th>
              <th className="px-3 py-2 text-right font-medium">Aéreo (d)</th>
              <th className="px-3 py-2 text-center font-medium">Padrão</th>
              <th className="px-3 py-2 text-right font-medium">Efetivo</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const effective = modal === 'air' ? air : sea;
  const dirty = sea !== row.seaDays || air !== row.airDays || modal !== row.defaultModal;

  function save() {
    setStatus('saving');
    setError(null);
    startTransition(async () => {
      try {
        await updateLeadTimePolicy(row.skuBase, { seaDays: sea, airDays: air, defaultModal: modal });
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
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
        <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABEL[row.leadTimeSource]}</td>
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
          <td colSpan={7} className="px-3 pb-2">
            <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
          </td>
        </tr>
      )}
    </>
  );
}
