'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { ConsumptionRecord } from '@/types';

interface ConsumptionBarChartProps {
  records: ConsumptionRecord[];
  itemGroup: string;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const { qtd, os } = payload[0].payload;
  return (
    <div
      className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      <p className="mb-1 font-semibold">{label}</p>
      <p className="text-emerald-500">{qtd} unidades consumidas</p>
      {os?.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          OS: {os.join(', ')}
        </p>
      )}
    </div>
  );
}

export function ConsumptionBarChart({ records, itemGroup }: ConsumptionBarChartProps) {
  if (records.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          Sem dados de consumo para <span className="font-medium">{itemGroup}</span> nesta base nos últimos 30 dias.
        </p>
      </div>
    );
  }

  const monthlyAvg = records[0].monthlyAvg;

  const data = [...records]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({
      dia: formatDay(r.day),
      qtd: r.qtyConsumed,
      os: r.os,
    }));

  // Show date labels every 7 days to avoid crowding
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Consumo diário — {itemGroup}
        </h3>
        <span className="text-xs text-muted-foreground">
          Média 30d:{' '}
          <span className="font-medium text-amber-500">{monthlyAvg.toFixed(1)} un/dia</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="dia"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={monthlyAvg}
            stroke="hsl(var(--amber-500, 245 158 11))"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{
              value: `avg ${monthlyAvg.toFixed(1)}`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: '#f59e0b',
            }}
          />
          <Bar dataKey="qtd" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
