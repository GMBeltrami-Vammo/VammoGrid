'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
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
import type { InventoryItem } from '@/types';

const col = createColumnHelper<InventoryItem>();

const columns = [
  col.accessor('skuName', {
    header: 'Peça / SKU',
    cell: (info) => (
      <span className="font-medium">{info.getValue()}</span>
    ),
  }),
  col.accessor('category', {
    header: 'Categoria',
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() || '—'}</span>
    ),
  }),
  col.accessor('qtyAvailable', {
    header: 'Qtd. Disponível',
    cell: (info) => (
      <span className="tabular-nums font-medium">{info.getValue()}</span>
    ),
  }),
  col.accessor('doh', {
    header: 'DOH',
    cell: (info) => (
      <DohBadge
        doh={info.getValue()}
        status={info.row.original.dohStatus}
        showDays
      />
    ),
    sortingFn: (a, b) => {
      const da = a.original.doh ?? -1;
      const db = b.original.doh ?? -1;
      return da - db;
    },
  }),
  col.accessor('skuId', {
    header: 'Código',
    cell: (info) => (
      <span className="text-xs text-muted-foreground font-mono">{info.getValue()}</span>
    ),
  }),
];

interface InventoryTableProps {
  items: InventoryItem[];
  isLoading?: boolean;
  onRowSelect?: (item: InventoryItem) => void;
  selectedSkuId?: string;
}

export function InventoryTable({
  items,
  isLoading,
  onRowSelect,
  selectedSkuId,
}: InventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'doh', desc: false },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');

  const data = useMemo(() => items, [items]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <input
          type="text"
          placeholder="Filtrar por nome, código ou categoria..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' && ' ↑'}
                    {header.column.getIsSorted() === 'desc' && ' ↓'}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  Nenhum item encontrado.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onRowSelect?.(row.original)}
                  className={[
                    onRowSelect ? 'cursor-pointer hover:bg-muted/50' : '',
                    selectedSkuId === row.original.skuId ? 'bg-emerald-50 dark:bg-emerald-950/20' : '',
                  ].join(' ')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {table.getFilteredRowModel().rows.length} de {items.length} itens
      </p>
    </div>
  );
}
