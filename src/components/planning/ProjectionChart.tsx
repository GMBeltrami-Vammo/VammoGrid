'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProjectionPoint } from '@/types/planning';
import { fmtDate, fmtInt } from '@/lib/planning/format';

// Projection cone: shaded lo–hi band + the central stock line, with a red marker at
// the projected stockout date. Pure presentational client island.

export function ProjectionChart({
  timeline,
  stockoutDate,
  overlayTimeline,
  overlayLabel = 'Simulado',
  height = 300,
}: {
  timeline: ProjectionPoint[];
  stockoutDate?: string | null;
  overlayTimeline?: ProjectionPoint[] | null;
  overlayLabel?: string;
  height?: number;
}) {
  const data = timeline.map((p, i) => ({
    date: p.date,
    stock: p.stock,
    band: [p.stockLo, p.stockHi] as [number, number],
    sim: overlayTimeline?.[i]?.stock,
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            interval={Math.max(0, Math.floor(data.length / 6) - 1)}
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
            formatter={(value: unknown, name: unknown) => {
              if (name === 'band' && Array.isArray(value)) {
                return [`${fmtInt(value[0])} – ${fmtInt(value[1])}`, 'Faixa (lo–hi)'];
              }
              if (name === 'sim') return [fmtInt(Number(value)), overlayLabel];
              return [fmtInt(Number(value)), 'Estoque previsto'];
            }}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <Area
            dataKey="band"
            stroke="none"
            fill="var(--color-brand-500)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
          <Line
            dataKey="stock"
            stroke="var(--color-brand-500)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {overlayTimeline && (
            <Line
              dataKey="sim"
              stroke="var(--color-alert-success)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {stockoutDate && (
            <ReferenceLine
              x={stockoutDate}
              stroke="var(--color-alert-error)"
              strokeDasharray="4 2"
              label={{ value: 'ruptura', fill: 'var(--color-alert-error)', fontSize: 10, position: 'top' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
