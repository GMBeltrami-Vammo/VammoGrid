'use client';

import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ConsumptionRecord, InventorySnapshot } from '@/types';

interface ConsumptionBarChartProps {
  records: ConsumptionRecord[];
  history: InventorySnapshot[];
  itemGroup: string;
}

function formatDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const consumed = payload.find((p: any) => p.dataKey === 'qty_consumed');
  const available = payload.find((p: any) => p.dataKey === 'qty_available');
  const os: number[] = consumed?.payload?.os ?? [];

  return (
    <div
      className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
      style={{ borderColor: 'hsl(var(--border))' }}
    >
      <p className="mb-1 font-semibold">{label}</p>
      {consumed?.value != null && (
        <p className="text-brand-500">{consumed.value} unidades consumidas</p>
      )}
      {available?.value != null && (
        <p className="text-sky-500">{available.value} em estoque</p>
      )}
      {os.length > 0 && (
        <p className="mt-1 text-muted-foreground">OS: {os.join(', ')}</p>
      )}
    </div>
  );
}

export function ConsumptionBarChart({ records, history, itemGroup }: ConsumptionBarChartProps) {
  const hasConsumption = records.length > 0;
  const hasHistory = history.length > 0;

  if (!hasConsumption && !hasHistory) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          Sem dados para{' '}
          <span className="font-medium">{itemGroup}</span> nesta base nos últimos 30 dias.
        </p>
      </div>
    );
  }

  // Build a unified date index
  const dateSet = new Set<string>();
  records.forEach((r) => dateSet.add(r.day.slice(0, 10)));
  history.forEach((h) => dateSet.add(h.snapshotDate));
  const sortedDates = Array.from(dateSet).sort();

  const consumptionByDate = Object.fromEntries(
    records.map((r) => [r.day.slice(0, 10), r]),
  );
  const historyByDate = Object.fromEntries(
    history.map((h) => [h.snapshotDate, h]),
  );

  const data = sortedDates.map((date) => ({
    dia:           formatDay(date),
    qty_consumed:  consumptionByDate[date]?.qtyConsumed ?? null,
    os:            consumptionByDate[date]?.os ?? [],
    qty_available: historyByDate[date]?.qtyAvailable ?? null,
  }));

  const monthlyAvg = records[0]?.monthlyAvg ?? 0;
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Consumo diário — {itemGroup}
        </h3>
        <span className="text-xs text-muted-foreground">
          Média 30d:{' '}
          <span className="font-medium text-amber-500">
            {monthlyAvg.toFixed(1)} un/dia
          </span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />

          {/* Left axis — daily consumption */}
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
            allowDecimals={false}
          />

          {/* Right axis — qty available */}
          {hasHistory && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
              allowDecimals={false}
            />
          )}

          <XAxis
            dataKey="dia"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />

          <Tooltip content={<CustomTooltip />} />

          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) =>
              value === 'qty_available'
                ? 'Estoque disponível'
                : 'Consumido no dia'
            }
          />

          {/* Background area: stock level history */}
          {hasHistory && (
            <Area
              yAxisId="right"
              dataKey="qty_available"
              type="monotone"
              fill="#bae6fd"
              stroke="#38bdf8"
              strokeWidth={1.5}
              fillOpacity={0.35}
              dot={false}
              connectNulls
            />
          )}

          {/* Foreground bars: daily consumption (Vammo brand blue) */}
          <Bar
            yAxisId="left"
            dataKey="qty_consumed"
            fill="#0098db"
            radius={[3, 3, 0, 0]}
            maxBarSize={20}
          />

          {/* Reference line: 30-day avg consumption */}
          {monthlyAvg > 0 && (
            <ReferenceLine
              yAxisId="left"
              y={monthlyAvg}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: `avg ${monthlyAvg.toFixed(1)}`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: '#f59e0b',
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
