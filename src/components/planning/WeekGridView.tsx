'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { HubId, WeekGridRow } from '@/types/planning';
import type { WeekGrid } from '@/lib/planning/weekgrid';
import { fmtDate, fmtInt, weekCellClass } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/planning/InfoHint';

// Weekly stockout grid: rows = SKUs, columns = W1..W8 (end-of-week projected stock +
// DOH + color). Scope toggle + search + per-week new-stockout summary bar. Read-only —
// all four scopes are precomputed server-side; this island only switches the view.

type Scope = 'global' | HubId;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'osasco', label: 'Osasco' },
  { id: 'mooca', label: 'Mooca' },
  { id: 'sbc', label: 'SBC' },
];

type SortKey = 'urgency' | 'name';

export function WeekGridView({ grid }: { grid: WeekGrid }) {
  const [scope, setScope] = useState<Scope>('global');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('urgency');

  const allRows = scope === 'global' ? grid.global : grid.byHub[scope];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = allRows.filter(
      (r) => !q || r.skuName.toLowerCase().includes(q) || r.skuBase.toLowerCase().includes(q),
    );
    if (sort === 'name') {
      return [...out].sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));
    }
    return out; // server already sorted by urgency
  }, [allRows, search, sort]);

  // Per-week count of SKUs that FIRST rupture in that week (within the current scope).
  const summary = useMemo(() => {
    const counts = grid.weeks.map(() => 0);
    for (const r of allRows) {
      const firstOut = r.cells.findIndex((c) => c.isOut);
      if (firstOut !== -1) counts[firstOut]++;
    }
    return counts;
  }, [allRows, grid.weeks]);

  const totalAtRisk = useMemo(
    () => allRows.filter((r) => r.cells.some((c) => c.isOut)).length,
    [allRows],
  );

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                scope === s.id
                  ? 'bg-brand-500/20 text-brand-600'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-44 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />

        <div className="flex gap-1">
          {(['urgency', 'name'] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                sort === k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              {k === 'urgency' ? 'Urgência' : 'Nome'}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} SKUs · <span className="text-alert-error font-medium">{totalAtRisk}</span> com ruptura em 8 sem
        </span>
      </div>

      {/* Per-week new-stockout summary bar */}
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {grid.weeks.map((w, i) => (
          <div
            key={w.idx}
            className={cn(
              'rounded-lg border p-2 text-center',
              summary[i] > 0 ? 'border-alert-error/30 bg-alert-error/5' : 'border-border bg-muted/20',
            )}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Sem {w.idx}
            </p>
            <p className="text-[10px] text-muted-foreground">{fmtDate(w.endDate)}</p>
            <p
              className={cn(
                'mt-0.5 text-lg font-bold tabular-nums',
                summary[i] > 0 ? 'text-alert-error' : 'text-muted-foreground/40',
              )}
            >
              {summary[i]}
            </p>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 font-medium">SKU</th>
              {grid.weeks.map((w) => (
                <th key={w.idx} className="border-l border-foreground/5 px-2 py-2 text-center font-medium">
                  <span className="block">Sem {w.idx}</span>
                  <span className="block text-[10px] normal-case text-muted-foreground/70">
                    {fmtDate(w.endDate)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={grid.weeks.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              rows.map((r) => <GridRow key={r.skuBase} row={r} />)
            )}
          </tbody>
        </table>
      </div>

      <Legend />
    </div>
  );
}

function GridRow({ row }: { row: WeekGridRow }) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 align-middle">
        <Link
          prefetch={false}
          href={`/dashboard/estoque?sku=${encodeURIComponent(row.skuBase)}`}
          className="block font-mono text-[11px] text-brand-500 hover:text-brand-400 transition-colors"
        >
          {row.skuBase}
        </Link>
        <span className="block max-w-[180px] truncate text-[11px] text-muted-foreground" title={row.skuName}>
          {row.skuName}
        </span>
      </td>
      {row.cells.map((c, i) => {
        const isBuyBy = row.buyByWeekIdx === i + 1;
        return (
          <td
            key={i}
            className={cn(
              'border-l border-foreground/5 px-2 py-1.5 text-center align-middle tabular-nums',
              weekCellClass(c),
            )}
          >
            <span className="block text-xs font-semibold">{fmtInt(c.stock)}</span>
            <span className="block text-[10px] opacity-70">{c.doh != null ? `${c.doh}d` : '—'}</span>
            {(c.inbound > 0 || c.recovery > 0) && (
              <span className="block text-[9px] font-medium opacity-90">
                {c.inbound > 0 ? `+${fmtInt(c.inbound)}` : ''}
                {c.recovery > 0 ? ` ♻${fmtInt(c.recovery)}` : ''}
              </span>
            )}
            {isBuyBy && (
              <span className="block text-[9px] font-bold text-alert-warning" title="Comprar até esta semana">
                ⚑ pedir
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Legend() {
  const items = [
    { cls: 'bg-alert-error/15 text-alert-error', label: 'Ruptura (estoque ≤ 0)', hint: 'week-stock' as const },
    { cls: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]', label: 'Cobertura < 14d', hint: 'week-doh' as const },
    { cls: 'bg-alert-success/10 text-alert-success', label: 'Chegada de pedido (+un)', hint: 'week-inbound' as const },
    { cls: 'bg-brand-500/10 text-brand-600', label: 'Recuperação (♻)', hint: 'recovery-line' as const },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-3 rounded-sm', it.cls)} />
          {it.label} <InfoHint id={it.hint} />
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-alert-warning">⚑</span> Semana-limite de compra <InfoHint id="buy-by-week" />
      </span>
    </div>
  );
}
