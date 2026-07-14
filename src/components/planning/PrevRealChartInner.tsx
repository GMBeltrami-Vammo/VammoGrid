'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtDate, fmtInt } from '@/lib/planning/format';

// Recharts body for a previsão × realizado chart (review 8 fase 2), split out so the
// library is lazy-loaded (next/dynamic in PrevRealView). Two lines: previsto (dashed)
// vs realizado (solid).

export interface PrevRealDatum {
  date: string;
  prev: number | null;
  real: number | null;
}

export default function PrevRealChartInner({
  data,
  prevLabel,
  realLabel,
}: {
  data: PrevRealDatum[];
  prevLabel: string;
  realLabel: string;
}) {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            interval={Math.max(0, Math.floor(data.length / 8) - 1)}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            stroke="var(--color-border)"
          />
          <YAxis
            tickFormatter={(v) => fmtInt(v)}
            width={44}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            stroke="var(--color-border)"
          />
          <Tooltip
            labelFormatter={(l) => fmtDate(String(l))}
            formatter={(v: unknown, name: unknown) => [v == null ? '—' : fmtInt(Number(v)), String(name)]}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            dataKey="prev"
            name={prevLabel}
            stroke="var(--color-brand-500)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="real"
            name={realLabel}
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
