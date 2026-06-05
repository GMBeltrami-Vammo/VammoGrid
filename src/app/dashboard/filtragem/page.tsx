'use client';

import { useMemo, useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
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
}

export default function FiltragemPage() {
  const { data: items = [], isLoading } = useInventory();
  const { isIncluded, setIncluded, selectAll, clearAll, excludedCount } =
    useSkuFilter();
  const [search, setSearch] = useState('');

  // Dedupe (SKU × hub) → one row per unique SKU, with total stock
  const skus = useMemo<SkuRow[]>(() => {
    const map = new Map<string, SkuRow>();
    for (const item of items) {
      const existing = map.get(item.skuId);
      if (existing) {
        existing.totalQty += item.qtyAvailable;
      } else {
        map.set(item.skuId, {
          skuId: item.skuId,
          skuName: item.skuName,
          totalQty: item.qtyAvailable,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.skuName.localeCompare(b.skuName));
  }, [items]);

  const allSkuIds = useMemo(() => skus.map((s) => s.skuId), [skus]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return skus;
    return skus.filter(
      (s) =>
        s.skuName.toLowerCase().includes(q) || s.skuId.toLowerCase().includes(q),
    );
  }, [skus, search]);

  const includedCount = skus.length - excludedCount;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Filtragem</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Selecione os SKUs que devem aparecer em todo o site. SKUs desmarcados
          somem de todas as abas (Visão Geral, Fechamento e Alertas). Sua seleção
          fica salva neste navegador.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={selectAll}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
        >
          <CheckSquare className="h-4 w-4 text-emerald-500" />
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
          className="flex-1 min-w-48 rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                <TableHead>Peça / SKU</TableHead>
                <TableHead className="text-right">Estoque total</TableHead>
                <TableHead>Código</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Nenhum item encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((sku) => {
                  const active = isIncluded(sku.skuId);
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
                          onChange={(e) => setIncluded(sku.skuId, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer accent-emerald-600"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{sku.skuName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sku.totalQty}
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
