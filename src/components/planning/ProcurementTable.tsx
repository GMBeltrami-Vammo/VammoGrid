'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PurchaseSuggestion } from '@/types/planning';
import { byUrgency } from '@/lib/planning/selectors';
import { fmtBRL, fmtDate, fmtInt } from '@/lib/planning/format';
import { LatePill, StatusPill } from './ui';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'critical' | 'reorder' | 'late';

export function ProcurementTable({ rows }: { rows: PurchaseSuggestion[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((p) => {
        if (filter === 'critical' && p.status !== 'CRITICAL') return false;
        if (filter === 'reorder' && p.status !== 'REORDER') return false;
        if (filter === 'late' && !p.isLate) return false;
        if (needle && !p.skuName.toLowerCase().includes(needle) && !p.skuBase.toLowerCase().includes(needle))
          return false;
        return true;
      })
      .sort(byUrgency);
  }, [rows, q, filter]);

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'critical', label: 'Críticos' },
    { key: 'reorder', label: 'Recompra' },
    { key: 'late', label: 'Atrasados' },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar SKU ou descrição…"
          className="h-8 w-64 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
        />
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                filter === t.key
                  ? 'bg-brand-500/15 text-brand-600'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} SKUs</span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Estoque</th>
              <th className="px-3 py-2 text-right font-medium">Lead</th>
              <th className="px-3 py-2 text-right font-medium">ROP</th>
              <th className="px-3 py-2 text-right font-medium">Ruptura</th>
              <th className="px-3 py-2 text-right font-medium">Comprar até</th>
              <th className="px-3 py-2 text-right font-medium">Qtd</th>
              <th className="px-3 py-2 text-right font-medium">Custo est.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.map((p) => (
              <tr key={p.skuBase} className="align-top hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/sku/${encodeURIComponent(p.skuBase)}`}
                    className="font-medium text-foreground hover:text-brand-600"
                  >
                    {p.skuName}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    {p.skuBase} · {p.abcClass}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <StatusPill status={p.status} />
                    {p.isLate && <LatePill />}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(p.onHand)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.leadTimeDays}d</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(p.rop)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDate(p.stockoutDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDate(p.buyByDate)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {p.orderQty > 0 ? fmtInt(p.orderQty) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.estCost != null && p.orderQty > 0 ? fmtBRL(p.estCost) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
