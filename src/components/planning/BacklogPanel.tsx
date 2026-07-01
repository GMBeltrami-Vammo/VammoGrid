'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import {
  addBacklog,
  deleteBacklog,
  updateBacklogStatus,
  type BacklogStatus,
} from '@/app/dashboard/backlog/actions';
import { fmtDate } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

export interface BacklogRow {
  id: string;
  model: string;
  stalledSince: string;
  reason: string | null;
  status: BacklogStatus;
  resolvedAt: string | null;
  notes: string | null;
}

const STATUS_LABEL: Record<BacklogStatus, string> = {
  parado: 'Parado',
  em_reparo: 'Em reparo',
  reativado: 'Reativado',
};
const STATUS_CLASS: Record<BacklogStatus, string> = {
  parado: 'bg-alert-error/15 text-alert-error',
  em_reparo: 'bg-alert-warning/15 text-amber-600 dark:text-alert-warning',
  reativado: 'bg-alert-success/15 text-alert-success',
};
const STATUSES: BacklogStatus[] = ['parado', 'em_reparo', 'reativado'];

export function BacklogPanel({ rows, isHead }: { rows: BacklogRow[]; isHead: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BacklogStatus | 'all'>('all');
  const [model, setModel] = useState('');
  const [stalledSince, setStalledSince] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !r.model.toLowerCase().includes(q) && !(r.reason ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { parado: 0, em_reparo: 0, reativado: 0 } as Record<BacklogStatus, number>;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const add = () => {
    setError(null);
    startTransition(async () => {
      const res = await addBacklog({ model, stalledSince, reason });
      if (res.ok) {
        setModel('');
        setReason('');
        router.refresh();
      } else setError(res.error ?? 'Erro ao adicionar.');
    });
  };

  const setStatus = (id: string, status: BacklogStatus) => {
    startTransition(async () => {
      const res = await updateBacklogStatus(id, status);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Erro ao atualizar.');
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteBacklog(id);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Erro ao remover.');
    });
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar modelo / motivo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-56 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              statusFilter === s ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {s === 'all' ? 'Tudo' : `${STATUS_LABEL[s]} (${counts[s]})`}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} / {rows.length}</span>
      </div>

      {error && <p className="mb-2 text-xs text-alert-error">{error}</p>}

      {isHead && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input type="date" value={stalledSince} onChange={(e) => setStalledSince(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          <input placeholder="Modelo / placa" value={model} onChange={(e) => setModel(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500" />
          <input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500 sm:col-span-2" />
          <button onClick={add} disabled={pending} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-brand-500 px-3 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50">
            <Plus size={13} /> Adicionar
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum registro.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Modelo / placa</th>
                <th className="px-3 py-2 font-medium">Parada desde</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {isHead && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{r.model}</td>
                  <td className="px-3 py-2 tabular-nums text-xs">{fmtDate(r.stalledSince)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2">
                    {isHead ? (
                      <select
                        value={r.status}
                        onChange={(e) => setStatus(r.id, e.target.value as BacklogStatus)}
                        className={cn('h-7 rounded-full border-0 px-2 text-[11px] font-medium outline-none', STATUS_CLASS[r.status])}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_CLASS[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    )}
                  </td>
                  {isHead && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remove(r.id)} disabled={pending} aria-label="Remover" className="text-muted-foreground hover:text-alert-error">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
