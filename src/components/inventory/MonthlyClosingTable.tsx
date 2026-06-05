'use client';

import { useMemo, useState } from 'react';
import { useMonthlyClosing } from '@/hooks/useMonthlyClosing';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { DohBadge } from './DohBadge';
import type { DohStatus, HubId } from '@/types';

const DOH_WARNING = 14;
const DOH_CRITICAL = 7;

function dohStatus(doh: number | null): DohStatus {
  if (doh === null) return 'unknown';
  if (doh <= DOH_CRITICAL) return 'critical';
  if (doh <= DOH_WARNING) return 'warning';
  return 'ok';
}

function formatMonth(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function MonthlyClosingTable({ hubId }: { hubId: HubId }) {
  const { data: rows = [], isLoading } = useMonthlyClosing(hubId);
  const { excluded } = useSkuFilter();
  const [search, setSearch] = useState('');

  // Distinct closing months (already sorted desc by the query)
  const months = useMemo(
    () => [...new Set(rows.map((r) => r.closingMonth))],
    [rows],
  );
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const activeMonth = selectedMonth ?? months[0] ?? null;

  const visibleRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter((r) => r.closingMonth === activeMonth)
      .filter((r) => !excluded.has(r.skuId))
      .filter(
        (r) =>
          !q ||
          r.skuName.toLowerCase().includes(q) ||
          r.skuId.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // critical DOH first; nulls last
        const da = a.doh ?? Infinity;
        const db = b.doh ?? Infinity;
        return da - db;
      });
  }, [rows, activeMonth, excluded, search]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          Nenhum fechamento registrado ainda. O primeiro será gravado
          automaticamente no dia 30.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={activeMonth ?? ''}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm capitalize shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {months.map((m) => (
            <option key={m} value={m} className="capitalize">
              {formatMonth(m)}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filtrar por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peça / SKU</TableHead>
              <TableHead className="text-right">Estoque no fechamento</TableHead>
              <TableHead className="text-right">Consumo médio (un/dia)</TableHead>
              <TableHead>DOH</TableHead>
              <TableHead>Código</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  Nenhum item neste fechamento.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((r) => (
                <TableRow key={`${r.skuId}-${r.closingMonth}`}>
                  <TableCell className="font-medium">{r.skuName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.qtyAvailable}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.avgDailyConsumption.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <DohBadge doh={r.doh} status={dohStatus(r.doh)} showDays />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.skuId}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {visibleRows.length} itens · fechamento de{' '}
        <span className="capitalize">
          {activeMonth ? formatMonth(activeMonth) : '—'}
        </span>
      </p>
    </div>
  );
}
