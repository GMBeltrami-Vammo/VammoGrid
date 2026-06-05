'use client';

import { useMemo, useState } from 'react';
import {
  CheckSquare,
  Square,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { useInventory } from '@/hooks/useInventory';
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

interface SkuRow {
  skuId: string;
  skuName: string;
  totalQty: number;
  /** total daily consumption across hubs (un/dia) */
  dailyConsumption: number;
}

type SortKey = 'name' | 'qty' | 'consumo';
type SortDir = 'asc' | 'desc';

export function FilterTable() {
  const { data: items = [], isLoading } = useInventory();
  const { isIncluded, setIncluded, selectAll, clearAll, excludedCount } =
    useSkuFilter();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Dedupe (SKU × hub) → one row per unique SKU, summing stock + consumption
  const skus = useMemo<SkuRow[]>(() => {
    const map = new Map<string, SkuRow>();
    for (const item of items) {
      const existing = map.get(item.skuId);
      if (existing) {
        existing.totalQty += item.qtyAvailable;
        existing.dailyConsumption += item.dailyConsumption;
      } else {
        map.set(item.skuId, {
          skuId: item.skuId,
          skuName: item.skuName,
          totalQty: item.qtyAvailable,
          dailyConsumption: item.dailyConsumption,
        });
      }
    }
    return [...map.values()];
  }, [items]);

  const allSkuIds = useMemo(() => skus.map((s) => s.skuId), [skus]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? skus.filter(
          (s) =>
            s.skuName.toLowerCase().includes(q) ||
            s.skuId.toLowerCase().includes(q),
        )
      : skus;

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.skuName.localeCompare(b.skuName) * dir;
      if (sortKey === 'qty') return (a.totalQty - b.totalQty) * dir;
      return (a.dailyConsumption - b.dailyConsumption) * dir;
    });
  }, [skus, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // sensible default: name ascending, numeric columns descending
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3 text-brand-500" />
    ) : (
      <ChevronDown className="h-3 w-3 text-brand-500" />
    );
  }

  const includedCount = skus.length - excludedCount;

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Selecione os SKUs que devem aparecer em todo o site. SKUs desmarcados
        somem de todas as abas (Visão Geral por base, Fechamento e Alertas). Sua
        seleção fica salva neste navegador. Esta tabela sempre mostra todos os
        SKUs.
      </p>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={selectAll}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
        >
          <CheckSquare className="h-4 w-4 text-brand-500" />
          Selecionar todos
        </button>
        <button
          onClick={() => clearAll(allSkuIds)}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
        >
          <Square className="h-4 w-4 text-muted-foreground" />
          Limpar todos
        </button>
        <input
          type="text"
          placeholder="Filtrar por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{includedCount}</span> de{' '}
        {skus.length} SKUs ativos no filtro global
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-center">Ativo</TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort('name')}
                >
                  <span className="inline-flex items-center gap-1">
                    Peça / SKU <SortIcon col="name" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right"
                  onClick={() => toggleSort('qty')}
                >
                  <span className="inline-flex items-center gap-1">
                    Estoque total <SortIcon col="qty" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right"
                  onClick={() => toggleSort('consumo')}
                >
                  <span className="inline-flex items-center gap-1">
                    Consumo médio <SortIcon col="consumo" />
                  </span>
                </TableHead>
                <TableHead>Código</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Nenhum item encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((sku) => {
                  const active = isIncluded(sku.skuId);
                  const monthly = Math.round(sku.dailyConsumption * 30);
                  return (
                    <TableRow
                      key={sku.skuId}
                      onClick={() => setIncluded(sku.skuId, !active)}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) =>
                            setIncluded(sku.skuId, e.target.checked)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer accent-brand-600"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{sku.skuName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sku.totalQty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {monthly}
                        <span className="ml-0.5 text-xs text-muted-foreground">
                          un/mês
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {sku.skuId}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
