'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, Ship, Plane } from 'lucide-react';
import type { ElaborationRow } from '@/lib/planning/load';
import type { TransportModal } from '@/types/planning';
import { createPedido } from '@/app/dashboard/pedidos/actions';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

// "Novo Pedido" builder: the SKUs that need buying (DOH<floor in the horizon), each
// with a checkbox + editable qty; the MODAL is one global choice for the whole order;
// "Criar pedido" writes a single pedido (one VO, all checked SKUs as lines).

export function ProcurementView({ rows, isHead }: { rows: ElaborationRow[]; isHead: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<TransportModal>('sea');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  // Per-SKU inclusion + qty. Default: all included at the suggested qty.
  const [included, setIncluded] = useState<Set<string>>(() => new Set(rows.map((r) => r.suggestion.skuBase)));
  const [qtys, setQtys] = useState<Record<string, number>>(
    () => Object.fromEntries(rows.map((r) => [r.suggestion.skuBase, r.suggestedQty])),
  );
  const [error, setError] = useState<string | null>(null);
  const [createdVo, setCreatedVo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.suggestion.skuBase.toLowerCase().includes(q) || (r.suggestion.skuName ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selectedRows = rows.filter((r) => included.has(r.suggestion.skuBase) && (qtys[r.suggestion.skuBase] ?? 0) > 0);
  const selectedCount = selectedRows.length;
  const selectedUnits = selectedRows.reduce((s, r) => s + (qtys[r.suggestion.skuBase] ?? 0), 0);

  const toggle = (sku: string) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });

  const allVisibleIncluded = filtered.length > 0 && filtered.every((r) => included.has(r.suggestion.skuBase));
  const toggleAllVisible = () =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (allVisibleIncluded) filtered.forEach((r) => next.delete(r.suggestion.skuBase));
      else filtered.forEach((r) => next.add(r.suggestion.skuBase));
      return next;
    });

  const criarPedido = () => {
    setError(null);
    setCreatedVo(null);
    startTransition(async () => {
      const res = await createPedido({
        modal,
        orderDate,
        lines: selectedRows.map((r) => ({
          skuBase: r.suggestion.skuBase,
          skuName: r.suggestion.skuName,
          qty: qtys[r.suggestion.skuBase] ?? 0,
          leadDays: modal === 'sea' ? r.suggestion.leadTimeSeaDays : r.suggestion.leadTimeAirDays,
        })),
      });
      if (res.ok) {
        setCreatedVo(res.vo ?? null);
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao criar pedido.');
      }
    });
  };

  const exportCsv = () => {
    const header = ['sku', 'nome', 'doh_hoje', 'consumo_dia', 'ruptura', 'chegada', 'qtd', 'incluido'];
    const lines = filtered.map((r) => {
      const s = r.suggestion;
      return [
        s.skuBase,
        `"${(s.skuName ?? '').replace(/"/g, '""')}"`,
        s.dohNow != null ? Math.round(s.dohNow) : '',
        s.dailyDemand.toFixed(2),
        s.firstBreachDate ?? '',
        s.expectedArrival ?? '',
        qtys[s.skuBase] ?? 0,
        included.has(s.skuBase) ? 'sim' : 'nao',
      ].join(',');
    });
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novo-pedido-${orderDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Order-level controls */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Modal do pedido</span>
          <div className="mt-1 inline-flex overflow-hidden rounded-md border border-border">
            {(['sea', 'air'] as TransportModal[]).map((m) => (
              <button
                key={m}
                onClick={() => setModal(m)}
                className={cn(
                  'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors',
                  modal === m ? 'bg-brand-500 text-white' : 'bg-card text-muted-foreground hover:bg-muted/50',
                )}
              >
                {m === 'sea' ? <Ship size={13} /> : <Plane size={13} />}
                {m === 'sea' ? 'Marítimo' : 'Aéreo'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Data do pedido</span>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCount}</span> SKUs · {fmtInt(selectedUnits)} un.
          </span>
          {isHead && (
            <button
              onClick={criarPedido}
              disabled={pending || selectedCount === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
            >
              <Check size={15} /> {pending ? 'Criando…' : 'Criar pedido'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>}
      {createdVo && (
        <p className="mb-3 rounded-md bg-alert-success/10 px-3 py-2 text-sm text-alert-success">
          Pedido criado.{' '}
          <Link href={`/dashboard/pedidos/${encodeURIComponent(createdVo)}`} className="font-medium hover:underline">
            Ver {createdVo} →
          </Link>
        </p>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
        >
          <Download size={13} /> Exportar CSV
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} / {rows.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-3 py-2.5">
                {isHead && (
                  <input
                    type="checkbox"
                    aria-label="Incluir todos visíveis"
                    checked={allVisibleIncluded}
                    onChange={toggleAllVisible}
                    className="size-3.5 cursor-pointer accent-brand-500 align-middle"
                  />
                )}
              </th>
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 text-right font-medium">DOH hoje</th>
              <th className="px-3 py-2.5 font-medium">Ruptura prev.</th>
              <th className="px-3 py-2.5 font-medium">Chegada ({modal === 'sea' ? 'mar' : 'aéreo'})</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum SKU precisa de pedido no horizonte (cobertura acima do piso).
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const s = r.suggestion;
                const leadDays = modal === 'sea' ? s.leadTimeSeaDays : s.leadTimeAirDays;
                const arrival = addDaysStr(orderDate, leadDays);
                const isIn = included.has(s.skuBase);
                return (
                  <tr key={s.skuBase} className={cn('transition-colors', isIn ? 'bg-brand-500/[0.04]' : 'hover:bg-muted/30')}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${s.skuBase}`}
                        checked={isIn}
                        disabled={!isHead}
                        onChange={() => toggle(s.skuBase)}
                        className="size-3.5 cursor-pointer accent-brand-500 align-middle disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(s.skuBase)}`}
                        className="font-mono text-xs text-brand-500 hover:text-brand-400"
                      >
                        {s.skuBase}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">{s.skuName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.dohNow != null ? fmtInt(s.dohNow) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      <span className={s.isLate ? 'text-alert-error' : 'text-amber-600 dark:text-alert-warning'}>
                        {fmtDate(s.firstBreachDate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{fmtDate(arrival)}</td>
                    <td className="px-3 py-2 text-right">
                      {isHead ? (
                        <input
                          type="number"
                          min={0}
                          value={qtys[s.skuBase] ?? 0}
                          onChange={(e) => setQtys((p) => ({ ...p, [s.skuBase]: Number(e.target.value) }))}
                          className="h-7 w-24 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums outline-none focus:border-brand-500"
                        />
                      ) : (
                        <span className="tabular-nums">{fmtInt(qtys[s.skuBase] ?? 0)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Local DD-safe date add (client): orderDate + n days → YYYY-MM-DD.
function addDaysStr(iso: string, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(days)));
  return d.toISOString().slice(0, 10);
}
