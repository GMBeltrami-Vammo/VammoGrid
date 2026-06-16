'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  CheckSquare,
  Square,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Bike,
} from 'lucide-react';
import { useInventory } from '@/hooks/useInventory';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import { useCompat } from '@/hooks/useCompat';
import { BIKE_MODELS, type BikeModel } from '@/types';
import { MODEL_LABELS } from '@/constants/models';
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
  const { data: compatData = [] } = useCompat();
  const { isIncluded, setIncluded, selectAll, clearAll, keepOnly, excludedCount } =
    useSkuFilter();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedBikes, setSelectedBikes] = useState<Set<BikeModel>>(new Set());

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

  // Reactively apply bike compatibility filter whenever selection or data changes.
  // selectAll/keepOnly are stable callbacks (depend only on email via persist),
  // so including them in deps won't cause loops.
  useEffect(() => {
    if (allSkuIds.length === 0) return;
    if (selectedBikes.size === 0) {
      selectAll();
      return;
    }
    const bikes = [...selectedBikes];
    // Metabase returns "VM-01-SUS0-3401" while part_compat stores "VM-01-SUS0-3401-01-01".
    // Normalize both to their base form (strip trailing -XX-XX revision suffix) to match.
    const stripSuffix = (sku: string) => sku.replace(/-\d{2}-\d{2}$/, '');
    const compatibleBase = new Set<string>();
    for (const row of compatData) {
      if (bikes.some((b) => row.models[b])) {
        compatibleBase.add(stripSuffix(row.sku));
      }
    }
    const compatible = new Set<string>(
      allSkuIds.filter((id) => compatibleBase.has(stripSuffix(id))),
    );
    keepOnly(compatible, allSkuIds);
  }, [selectedBikes, compatData, allSkuIds, selectAll, keepOnly]);

  function toggleBike(model: BikeModel) {
    setSelectedBikes((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

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

      {/* Bike compatibility filter */}
      <div className="mb-4 rounded-md border bg-muted/30 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Bike className="h-4 w-4 text-brand-500" />
          Filtrar por moto
          {selectedBikes.size > 0 && (
            <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white leading-none">
              {selectedBikes.size}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BIKE_MODELS.map((model) => {
            const active = selectedBikes.has(model);
            return (
              <button
                key={model}
                onClick={() => toggleBike(model)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-border bg-background text-muted-foreground hover:border-brand-400 hover:text-foreground'
                }`}
              >
                {MODEL_LABELS[model]}
              </button>
            );
          })}
          {selectedBikes.size > 0 && (
            <button
              onClick={() => setSelectedBikes(new Set())}
              className="rounded-full border border-dashed border-muted-foreground/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/70 hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
        {selectedBikes.size > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Apenas SKUs compatíveis com{' '}
            <span className="font-medium text-foreground">
              {[...selectedBikes].map((b) => MODEL_LABELS[b]).join(', ')}
            </span>{' '}
            estão ativos.
          </p>
        )}
      </div>

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
