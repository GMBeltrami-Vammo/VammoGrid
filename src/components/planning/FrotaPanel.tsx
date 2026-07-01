'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { addFrotaEntry, deleteFrotaEntry, type FrotaLog } from '@/app/dashboard/frota/actions';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

export interface FrotaRow {
  id: string;
  date: string;
  model: string;
  qty: number;
  note: string | null;
  createdBy: string | null;
}

// One manual ledger (sales or orders) — add-row form + recent entries. Head-gated.
export function FrotaPanel({
  log,
  title,
  rows,
  isHead,
}: {
  log: FrotaLog;
  title: string;
  rows: FrotaRow[];
  isHead: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [model, setModel] = useState('');
  const [qty, setQty] = useState<number>(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = rows.reduce((s, r) => s + r.qty, 0);

  const add = () => {
    setError(null);
    startTransition(async () => {
      const res = await addFrotaEntry(log, { date, model, qty, note });
      if (res.ok) {
        setModel('');
        setQty(0);
        setNote('');
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao adicionar.');
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteFrotaEntry(log, id);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Erro ao remover.');
    });
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} lançamentos · total {fmtInt(total)}
        </span>
      </div>

      {error && <p className="mb-2 text-xs text-alert-error">{error}</p>}

      {isHead && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
          />
          <input
            placeholder="Modelo"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500 sm:col-span-2"
          />
          <input
            type="number"
            placeholder="Qtd"
            value={qty || ''}
            onChange={(e) => setQty(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
          <button
            onClick={add}
            disabled={pending}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-brand-500 px-3 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50"
          >
            <Plus size={13} /> Adicionar
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 font-medium">Nota</th>
                {isHead && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 tabular-nums text-xs">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2">{r.model}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums', r.qty < 0 && 'text-alert-error')}>{fmtInt(r.qty)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">{r.note ?? '—'}</td>
                  {isHead && (
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => remove(r.id)}
                        disabled={pending}
                        aria-label="Remover"
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
      )}
    </div>
  );
}
