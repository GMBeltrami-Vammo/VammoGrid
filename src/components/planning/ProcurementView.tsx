'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, Ship, Plane } from 'lucide-react';
import type { ElaborationRow } from '@/lib/planning/load';
import type { TransportModal } from '@/types/planning';
import { createElaboratedOrder } from '@/app/dashboard/pedidos/actions';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

// Compras rebuilt around the elaboration-trigger rule (B7). The list is computed
// on load (pure); nothing is written until a Head confirms a row → createElaboratedOrder.

type ModalFilter = 'all' | 'sea' | 'air';
type OriginFilter = 'all' | 'national' | 'international';

export function ProcurementView({
  rows,
  isHead,
}: {
  rows: ElaborationRow[];
  isHead: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [modalFilter, setModalFilter] = useState<ModalFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [lateOnly, setLateOnly] = useState(false);
  const [noOpenOnly, setNoOpenOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const s = r.suggestion;
      if (q && !s.skuName?.toLowerCase().includes(q) && !s.skuBase.toLowerCase().includes(q)) return false;
      if (modalFilter !== 'all' && s.suggestedModal !== modalFilter) return false;
      if (originFilter === 'national' && !r.isNational) return false;
      if (originFilter === 'international' && r.isNational) return false;
      if (lateOnly && !s.isLate) return false;
      if (noOpenOnly && r.hasOpenOrder) return false;
      return true;
    });
  }, [rows, search, modalFilter, originFilter, lateOnly, noOpenOnly]);

  const exportCsv = () => {
    const header = ['sku', 'nome', 'doh_hoje', 'consumo_dia', 'ruptura', 'modal', 'chegada', 'atrasado', 'qtd', 'custo_est'];
    const lines = filtered.map((r) => {
      const s = r.suggestion;
      return [
        s.skuBase,
        `"${(s.skuName ?? '').replace(/"/g, '""')}"`,
        s.dohNow != null ? Math.round(s.dohNow) : '',
        s.dailyDemand.toFixed(2),
        s.firstBreachDate ?? '',
        s.suggestedModal ?? '',
        s.expectedArrival ?? '',
        s.isLate ? 'sim' : 'nao',
        r.suggestedQty,
        r.estCost ?? '',
      ].join(',');
    });
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras-elaboracao-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        <Chip active={modalFilter === 'sea'} onClick={() => setModalFilter(modalFilter === 'sea' ? 'all' : 'sea')}>Marítimo</Chip>
        <Chip active={modalFilter === 'air'} onClick={() => setModalFilter(modalFilter === 'air' ? 'all' : 'air')}>Aéreo</Chip>
        <span className="mx-1 h-4 w-px bg-border" />
        <Chip active={originFilter === 'national'} onClick={() => setOriginFilter(originFilter === 'national' ? 'all' : 'national')}>Nacional</Chip>
        <Chip active={originFilter === 'international'} onClick={() => setOriginFilter(originFilter === 'international' ? 'all' : 'international')}>Internacional</Chip>
        <span className="mx-1 h-4 w-px bg-border" />
        <Chip active={lateOnly} onClick={() => setLateOnly(!lateOnly)}>Atrasados</Chip>
        <Chip active={noOpenOnly} onClick={() => setNoOpenOnly(!noOpenOnly)}>Sem pedido aberto</Chip>

        <button
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
        >
          <Download size={13} /> Exportar CSV
        </button>
        <span className="text-[11px] text-muted-foreground">{filtered.length} / {rows.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 text-right font-medium">DOH hoje</th>
              <th className="px-3 py-2.5 font-medium">Ruptura prev.</th>
              <th className="px-3 py-2.5 font-medium">Modal</th>
              <th className="px-3 py-2.5 font-medium">Chegada</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd sugerida</th>
              <th className="px-3 py-2.5 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum SKU precisa de pedido no horizonte (DOH ≥ 75 em toda a projeção).
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <Row key={r.suggestion.skuBase} row={r} isHead={isHead} onCreated={() => router.refresh()} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, isHead, onCreated }: { row: ElaborationRow; isHead: boolean; onCreated: () => void }) {
  const s = row.suggestion;
  const [qty, setQty] = useState(row.suggestedQty);
  const [modal, setModal] = useState<TransportModal>(s.suggestedModal ?? 'sea');
  const [done, setDone] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const orderDate = modal === 'sea' ? s.suggestedOrderDate ?? row.suggestion.firstBreachDate ?? '' : new Date().toISOString().slice(0, 10);
      const res = await createElaboratedOrder({
        skuBase: s.skuBase,
        skuName: s.skuName,
        qty,
        modal,
        orderDate: orderDate || new Date().toISOString().slice(0, 10),
        eta: modal === s.suggestedModal ? s.expectedArrival : null,
        leadTimeDays: modal === 'sea' ? s.leadTimeSeaDays : s.leadTimeAirDays,
      });
      if (res.ok) {
        setDone(true);
        setCreatedId(res.id ?? null);
        onCreated();
      } else {
        setError(res.error ?? 'Erro ao elaborar pedido.');
      }
    });
  };

  return (
    <tr className={cn('transition-colors', s.isLate ? 'bg-alert-error/[0.04]' : 'hover:bg-muted/30')}>
      <td className="px-3 py-2">
        <Link
          prefetch={false}
          href={`/dashboard/estoque?sku=${encodeURIComponent(s.skuBase)}`}
          className="font-mono text-xs text-brand-500 hover:text-brand-400"
        >
          {s.skuBase}
        </Link>
      </td>
      <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{s.skuName}</td>
      <td className="px-3 py-2 text-right tabular-nums">{s.dohNow != null ? fmtInt(s.dohNow) : '—'}</td>
      <td className="px-3 py-2 tabular-nums text-xs">
        <span className={s.isLate ? 'text-alert-error' : 'text-amber-600 dark:text-alert-warning'}>
          {fmtDate(s.firstBreachDate)}
        </span>
        {s.isLate && <span className="ml-1 text-[10px] font-semibold text-alert-error">ATRASADO</span>}
      </td>
      <td className="px-3 py-2">
        {isHead && !done ? (
          <select
            value={modal}
            onChange={(e) => setModal(e.target.value as TransportModal)}
            className="h-7 rounded border border-input bg-background px-1.5 text-xs outline-none"
          >
            <option value="sea">Marítimo</option>
            <option value="air">Aéreo</option>
          </select>
        ) : (
          <ModalBadge modal={modal} />
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{fmtDate(s.expectedArrival)}</td>
      <td className="px-3 py-2 text-right">
        {isHead && !done ? (
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="h-7 w-24 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums outline-none"
          />
        ) : (
          <span className="tabular-nums">{fmtInt(qty)}</span>
        )}
      </td>
      <td className="px-3 py-2">
        {done ? (
          createdId ? (
            <Link
              href={`/dashboard/pedidos/${encodeURIComponent(createdId)}`}
              prefetch={false}
              className="inline-flex items-center gap-1 text-xs font-medium text-alert-success hover:underline"
            >
              <Check size={13} /> Elaborado — ver pedido
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-alert-success">
              <Check size={13} /> Elaborado
            </span>
          )
        ) : isHead ? (
          <button
            onClick={confirm}
            disabled={pending || !(qty > 0)}
            className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {pending ? 'Elaborando…' : 'Elaborar'}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">{row.hasOpenOrder ? 'tem pedido' : '—'}</span>
        )}
        {error && <p className="mt-1 text-[10px] text-alert-error">{error}</p>}
      </td>
    </tr>
  );
}

function ModalBadge({ modal }: { modal: TransportModal }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {modal === 'sea' ? <Ship size={13} /> : <Plane size={13} />}
      {modal === 'sea' ? 'Marítimo' : 'Aéreo'}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
