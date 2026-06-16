'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjections } from '@/hooks/useProjections';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import { cn } from '@/lib/utils';
import type { StockProjection } from '@/types';

export function ProjectionPanel() {
  const { data, isLoading, isError } = useProjections();
  const { excluded } = useSkuFilter();
  const [search, setSearch] = useState('');
  const [onlyRisk, setOnlyRisk] = useState(true);
  const [openSku, setOpenSku] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data
      .filter((p) => !excluded.has(p.sku))
      .filter((p) => (onlyRisk ? p.daysUntilStockout != null : true))
      .filter(
        (p) =>
          !q ||
          p.sku.toLowerCase().includes(q) ||
          p.skuName.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const da = a.daysUntilStockout ?? Infinity;
        const db = b.daysUntilStockout ?? Infinity;
        if (da !== db) return da - db;
        return (a.dohNow ?? Infinity) - (b.dohNow ?? Infinity);
      });
  }, [data, excluded, search, onlyRisk]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar SKU ou item…"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyRisk}
            onChange={(e) => setOnlyRisk(e.target.checked)}
            className="accent-brand-500"
          />
          Apenas com ruptura projetada
        </label>
        <p className="ml-auto text-sm text-muted-foreground">{rows.length} SKUs</p>
      </div>

      <p className="text-xs text-muted-foreground">
        Projeção a 120 dias: estoque atual − consumo diário + pedidos (na ETA) +
        recuperação. Ordenado pela data de ruptura mais próxima.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar projeção.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum SKU {onlyRisk ? 'com ruptura projetada' : 'encontrado'}.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Estoque</TableHead>
              <TableHead className="text-right">Consumo/dia</TableHead>
              <TableHead className="text-right">DOH atual</TableHead>
              <TableHead className="text-right">A caminho</TableHead>
              <TableHead className="text-right">Ruptura projetada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <ProjectionRow
                key={p.sku}
                p={p}
                open={openSku === p.sku}
                onToggle={() => setOpenSku(openSku === p.sku ? null : p.sku)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ProjectionRow({
  p,
  open,
  onToggle,
}: {
  p: StockProjection;
  open: boolean;
  onToggle: () => void;
}) {
  const days = p.daysUntilStockout;
  const riskClass =
    days == null
      ? 'text-muted-foreground'
      : days <= 7
        ? 'text-alert-error font-semibold'
        : days <= 21
          ? 'text-[#b8a800] dark:text-alert-warning font-medium'
          : 'text-foreground';

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
        <TableCell className="max-w-[220px] truncate text-muted-foreground">
          {p.skuName}
        </TableCell>
        <TableCell className="text-right tabular-nums">{p.currentStock}</TableCell>
        <TableCell className="text-right tabular-nums">
          {p.dailyConsumption.toFixed(1)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {p.dohNow == null ? '—' : `${Math.round(p.dohNow)}d`}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {p.incomingUnits > 0 ? p.incomingUnits : '—'}
        </TableCell>
        <TableCell className={cn('text-right tabular-nums', riskClass)}>
          {p.stockoutDate ? `${p.stockoutDate} (${days}d)` : 'sem ruptura'}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30">
            <ProjectionChart p={p} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ProjectionChart({ p }: { p: StockProjection }) {
  // Thin out x-axis labels for readability.
  const chartData = p.timeline.map((pt) => ({
    date: pt.date.slice(5), // MM-DD
    stock: pt.stock,
    inbound: pt.inbound,
  }));

  const stockoutLabel = p.stockoutDate?.slice(5);

  return (
    <div className="py-2">
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Recuperação e pedidos incluídos. Horizonte: 120 dias.
        </span>
        {p.incomingUnits > 0 && <span>A caminho: {p.incomingUnits} un</span>}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2ec2ff" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2ec2ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              interval={14}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={40}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid rgba(127,127,127,0.2)',
              }}
            />
            <Area
              type="monotone"
              dataKey="stock"
              stroke="#2ec2ff"
              strokeWidth={2}
              fill="url(#stockFill)"
              name="Estoque projetado"
            />
            {stockoutLabel && (
              <ReferenceLine
                x={stockoutLabel}
                stroke="#db4841"
                strokeDasharray="4 2"
                label={{ value: 'Ruptura', fontSize: 10, fill: '#db4841' }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
