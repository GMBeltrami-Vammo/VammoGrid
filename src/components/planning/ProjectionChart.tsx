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
import type { PoArrival } from '@/lib/planning/projection';
import { fmtDate, fmtInt } from '@/lib/planning/format';

// Projection cone: shaded lo–hi band + the central stock line, with a red marker at
// the projected stockout date. Pure presentational client island.

export function ProjectionChart({
  timeline,
  stockoutDate,
  overlayTimeline,
  overlayLabel = 'Simulado',
  overlayColor = 'var(--color-alert-success)',
  arrivals,
  history,
  height = 300,
}: {
  timeline: ProjectionPoint[];
  stockoutDate?: string | null;
  overlayTimeline?: ProjectionPoint[] | null;
  overlayLabel?: string;
  overlayColor?: string;
  /** Open-PO arrivals (date + VO + qty) to mark the cause of stock bumps. */
  arrivals?: PoArrival[] | null;
  history?: { date: string; stock: number }[] | null;
  height?: number;
}) {
  const todayMarker = timeline[0]?.date;
  // Drop history's "today" point: timeline[0] is also today, and a DUPLICATE category
  // on Recharts' x-axis silently breaks ReferenceLine positioning — the "hoje" divider,
  // the green pedido-arrival lines and the stockout marker all fail to render. Keeping
  // history strictly before today makes every date unique so the markers come back.
  const histData = (history ?? [])
    .filter((h) => !todayMarker || h.date < todayMarker)
    .map((h) => ({
      date: h.date,
      stock: h.stock,
      band: undefined as [number, number] | undefined,
      sim: undefined as number | undefined,
    }));
  const projData = timeline.map((p, i) => ({
    date: p.date,
    stock: p.stock,
    band: [p.stockLo, p.stockHi] as [number, number] | undefined,
    sim: overlayTimeline?.[i]?.stock,
  }));
  const data = [...histData, ...projData];

  // Pedido arrivals visible within this chart's window — mark the cause of bumps.
  const projDates = new Set(projData.map((d) => d.date));
  const arrivalMarkers = (arrivals ?? []).filter((a) => projDates.has(a.date));

  // Stock ENTRIES detected in the real history (left of "hoje"): a positive step in
  // on-hand is a receipt / pedido arriving. The orders table often lacks the received
  // PO, so we read it straight from the inventory series — any jump up that beats
  // normal day-to-day drift is flagged with a 📦 marker + the qty that came in.
  const entryMarkers: { date: string; delta: number }[] = [];
  for (let i = 1; i < histData.length; i++) {
    const prev = histData[i - 1].stock;
    const delta = histData[i].stock - prev;
    if (delta > 0 && delta >= Math.max(15, 0.2 * Math.max(prev, 1))) {
      entryMarkers.push({ date: histData[i].date, delta });
    }
  }

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
            fillOpacity={0.18}
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
              stroke={overlayColor}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {/* Detected stock entries (received pedidos) in the real history */}
          {entryMarkers.map((e) => (
            <ReferenceLine
              key={`entry-${e.date}`}
              x={e.date}
              stroke="var(--color-alert-success)"
              strokeDasharray="3 2"
              label={{
                value: `📦 +${fmtInt(e.delta)}`,
                position: 'insideTopLeft',
                fontSize: 9,
                fill: 'var(--color-alert-success)',
              }}
            />
          ))}
          {/* Pedido arrivals: a green line at each arrival date, labeled with VO + qty */}
          {arrivalMarkers.map((a) => (
            <ReferenceLine
              key={`po-${a.date}`}
              x={a.date}
              stroke="var(--color-alert-success)"
              strokeDasharray="3 2"
              label={{
                value: `${a.vos.length ? a.vos.join('/') + ' ' : ''}+${fmtInt(a.qty)}`,
                position: 'insideTopRight',
                fontSize: 9,
                fill: 'var(--color-alert-success)',
              }}
            />
          ))}
          {histData.length > 0 && todayMarker && (
            <ReferenceLine
              x={todayMarker}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="2 2"
              label={{ value: 'hoje', fill: 'var(--color-muted-foreground)', fontSize: 10, position: 'top' }}
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
