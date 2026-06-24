'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PurchaseStatus } from '@/types/planning';
import type { PlanningFilter } from '@/lib/planning/filter';
import { writeFilterCookie } from '@/lib/planning/applyFilter';
import { cn } from '@/lib/utils';
import { fmtDate, fmtInt } from '@/lib/planning/format';

export interface SkuRow {
  skuBase: string;
  skuName: string;
  category: string | null;
  abcClass: string;
  onHand: number;
  dohDays: number | null;
  status: PurchaseStatus;
  stockoutDate: string | null;
  isLate: boolean;
}

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  CRITICAL: 'Crítico',
  REORDER: 'Recompra',
  OK: 'OK',
};

const STATUS_CLASS: Record<PurchaseStatus, string> = {
  CRITICAL: 'bg-alert-error/15 text-alert-error',
  REORDER: 'bg-alert-warning/15 text-amber-600 dark:text-alert-warning',
  OK: 'bg-alert-success/15 text-alert-success',
};

const ABC_CLASS: Record<string, string> = {
  A: 'bg-brand-500/15 text-brand-600',
  B: 'bg-brand-500/10 text-brand-500',
  C: 'text-muted-foreground',
};

// App-wide category options — same set + values as the top FilterBar, so the two
// controls drive the one shared `vg:filter` cookie and stay in sync.
const CATEGORIES: { v: string | null; label: string }[] = [
  { v: null, label: 'Tudo' },
  { v: 'BIKE', label: 'Moto' },
  { v: 'BATTERY', label: 'Bateria' },
];

export function SkuTable({ rows, filter }: { rows: SkuRow[]; filter: PlanningFilter }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [abcFilter, setAbcFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | null>(null);

  // Category is the APP-WIDE filter (drives every page + syncs with the top bar):
  // write the shared cookie and refresh so the server re-renders the narrowed set.
  const setCategory = (v: string | null) => {
    writeFilterCookie({ models: filter.models, category: v, q: filter.q });
    router.refresh();
  };

  // ABC / status / search are local refinements within the already-narrowed set.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q))
        return false;
      if (abcFilter && r.abcClass !== abcFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, abcFilter, statusFilter]);

  const localActive = abcFilter || statusFilter || search;
  const clearAll = () => {
    setAbcFilter(null);
    setStatusFilter(null);
    setSearch('');
    if (filter.category != null) setCategory(null);
  };

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />

        {/* Category chips — app-wide (Moto/Bateria), synced with the top filter bar */}
        <span className="ml-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Categoria
        </span>
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            onClick={() => setCategory(c.v)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              filter.category === c.v
                ? 'bg-brand-500/20 text-brand-600'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {c.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />

        {/* ABC chips — local refinement */}
        {['A', 'B', 'C'].map((cls) => (
          <button
            key={cls}
            onClick={() => setAbcFilter(abcFilter === cls ? null : cls)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              abcFilter === cls
                ? 'bg-brand-500/20 text-brand-600'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            Classe {cls}
          </button>
        ))}

        {/* Status chips — local refinement */}
        {(['CRITICAL', 'REORDER', 'OK'] as PurchaseStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              statusFilter === s ? STATUS_CLASS[s] : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}

        {(localActive || filter.category != null) && (
          <button
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Limpar filtros
          </button>
        )}

        <span className="ml-auto text-[11px] text-muted-foreground">
          {filtered.length} / {rows.length} SKUs
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 font-medium">Categ.</th>
              <th className="px-3 py-2.5 font-medium">Classe</th>
              <th className="px-3 py-2.5 text-right font-medium">Estoque</th>
              <th className="px-3 py-2.5 text-right font-medium">Cobertura</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Ruptura</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.skuBase} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/sku/${encodeURIComponent(r.skuBase)}`}
                      className="font-mono text-xs text-brand-500 hover:text-brand-400 transition-colors"
                    >
                      {r.skuBase}
                    </Link>
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <Link
                      href={`/dashboard/sku/${encodeURIComponent(r.skuBase)}`}
                      className="truncate block text-foreground hover:text-brand-500 transition-colors"
                    >
                      {r.skuName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.category ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        ABC_CLASS[r.abcClass] ?? 'text-muted-foreground',
                      )}
                    >
                      {r.abcClass}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.onHand)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.dohDays != null ? `${fmtInt(r.dohDays)}d` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        STATUS_CLASS[r.status],
                      )}
                    >
                      {STATUS_LABEL[r.status]}
                      {r.isLate && ' ⚠'}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs">
                    {r.stockoutDate ? (
                      <span className="text-alert-error">{fmtDate(r.stockoutDate)}</span>
                    ) : (
                      <span className="text-alert-success">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
