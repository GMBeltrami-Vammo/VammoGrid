'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ConsumptionRecord } from '@/types';

interface ConsumptionBarChartProps {
  records: ConsumptionRecord[];
  skuName: string;
}

function formatWeek(weekStart: string): string {
  const d = new Date(weekStart);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function ConsumptionBarChart({ records, skuName }: ConsumptionBarChartProps) {
  if (records.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          Dados de consumo não disponíveis ainda — configure a questão Metabase de consumo.
        </p>
      </div>
    );
  }

  const data = [...records]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-8)
    .map((r) => ({
      semana: formatWeek(r.weekStart),
      qtd: r.qtyConsumed,
      os: r.soCount,
    }));

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        Consumo semanal — {skuName}
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="semana"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid hsl(var(--border))',
            }}
            formatter={(value, name) =>
              name === 'qtd'
                ? [`${value} unidades`, 'Consumido']
                : [`${value} OSs`, 'Ordens de Serviço']
            }
          />
          <Bar dataKey="qtd" fill="#10b981" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
