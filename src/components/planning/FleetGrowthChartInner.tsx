'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtDate, fmtInt } from '@/lib/planning/format';

// The Recharts part of the fleet-growth chart, split into its own module so the chart
// library is lazy-loaded (next/dynamic in FleetGrowthChart) instead of shipping in the
// frota route's initial bundle — same pattern as ProjectionChart.

// Distinct categorical hues (the --chart-* ramp is all one brand-cyan hue, so multiple
// models rendered as indistinguishable blues). These are visually separable per model.
const COLORS = [
  'var(--color-brand-500)', // cyan
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#ef4444', // red
  '#ec4899', // pink
];

export default function FleetGrowthChartInner({
  data,
  keys,
  today,
}: {
  data: Record<string, number | string>[];
  keys: string[];
  today: string;
}) {
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 8 }}>
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
            width={56}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            stroke="var(--color-border)"
          />
          <Tooltip
            labelFormatter={(l) => fmtDate(String(l))}
            formatter={(v: unknown, name: unknown) => [fmtInt(Number(v)), String(name)]}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine
            x={today}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="2 2"
            label={{ value: 'hoje', fill: 'var(--color-muted-foreground)', fontSize: 10, position: 'top' }}
          />
          {keys.map((k, i) => (
            <Line
              key={k}
              dataKey={k}
              name={k}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
