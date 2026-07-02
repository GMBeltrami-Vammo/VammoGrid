'use client';

import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProjectionPoint } from '@/types/planning';
import { forwardAvgDemand, type PoArrival } from '@/lib/planning/projection';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

// Projection cone: shaded lo–hi band + the central stock line, with a red marker at
// the projected stockout date. Defaults to DOH (days of cover) with a toggle to raw
// units; DOH(day) = stock(day) / avg daily demand of the NEXT 7 days (not that single
// day's demand — that was erratic); history uses today's forward rate.

type ChartUnit = 'doh' | 'units';

export function ProjectionChart({
  timeline,
  stockoutDate,
  overlayTimeline,
  overlayLabel = 'Simulado',
  overlayColor = 'var(--color-alert-success)',
  arrivals,
  history,
  height = 300,
  defaultUnit = 'doh',
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
  defaultUnit?: ChartUnit;
}) {
  const [unit, setUnit] = useState<ChartUnit>(defaultUnit);
  const isDoh = unit === 'doh';
  // Days-of-cover divisor: the avg daily demand over the NEXT 7 days at each point
  // (canonical DOH rate). History uses today's forward rate.
  const todayRate = forwardAvgDemand(timeline, 0, 7);
  const toVal = (units: number | undefined, rate: number): number | undefined => {
    if (units == null) return undefined;
    if (!isDoh) return units;
    return rate > 0 ? Math.round(units / rate) : undefined;
  };
  const yLabel = isDoh ? 'Cobertura (dias — DOH)' : 'Unidades (peças)';
  const fmtY = (v: number) => (isDoh ? `${fmtInt(v)}d` : fmtInt(v));

  const todayMarker = timeline[0]?.date;
  // Drop history's "today" point: timeline[0] is also today, and a DUPLICATE category
  // on Recharts' x-axis silently breaks ReferenceLine positioning — the "hoje" divider,
  // the green pedido-arrival lines and the stockout marker all fail to render. Keeping
  // history strictly before today makes every date unique so the markers come back.
  const histData = (history ?? [])
    .filter((h) => !todayMarker || h.date < todayMarker)
    .map((h) => ({
      date: h.date,
      stock: toVal(h.stock, todayRate),
      band: undefined as [number, number] | undefined,
      bandExtrap: undefined as [number, number] | undefined,
      sim: undefined as number | undefined,
    }));
  // Split the band at the model horizon: the in-model portion (brand) vs the
  // extrapolated tail (grey), so the made-up-beyond-the-model uncertainty reads as
  // distinct. The boundary point belongs to BOTH series so the two areas touch.
  const projData = timeline.map((p, i) => {
    const nextExtrap = i + 1 < timeline.length ? timeline[i + 1].extrapolated : false;
    const isBoundary = !p.extrapolated && nextExtrap;
    const rate = forwardAvgDemand(timeline, i, 7);
    const lo = toVal(p.stockLo, rate);
    const hi = toVal(p.stockHi, rate);
    const band = lo != null && hi != null ? ([lo, hi] as [number, number]) : undefined;
    return {
      date: p.date,
      stock: toVal(p.stock, rate),
      band: p.extrapolated ? undefined : band,
      bandExtrap: p.extrapolated || isBoundary ? band : undefined,
      sim: toVal(overlayTimeline?.[i]?.stock, rate),
    };
  });
  const data = [...histData, ...projData];

  // Where the model horizon ends and extrapolation begins (null if all in-model).
  const horizonBoundary = timeline.find((p) => p.extrapolated)?.date ?? null;

  // Pedido arrivals visible within this chart's window — mark the cause of bumps.
  const projDates = new Set(projData.map((d) => d.date));
  const arrivalMarkers = (arrivals ?? []).filter((a) => projDates.has(a.date));

  const valLabel = isDoh ? 'Cobertura' : 'Estoque previsto';

  return (
    <div style={{ width: '100%' }}>
      {/* Unit toggle — DOH (default) vs raw units. */}
      <div className="mb-2 flex items-center justify-end gap-1">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Eixo Y</span>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {(['doh', 'units'] as ChartUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                unit === u ? 'bg-brand-500 text-white' : 'bg-card text-muted-foreground hover:bg-muted/50',
              )}
            >
              {u === 'doh' ? 'DOH (dias)' : 'Unidades'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            interval={Math.max(0, Math.floor(data.length / 6) - 1)}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            stroke="var(--color-border)"
          />
          <YAxis
            tickFormatter={fmtY}
            width={64}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            stroke="var(--color-border)"
          >
            <Label
              value={yLabel}
              angle={-90}
              position="insideLeft"
              style={{ fontSize: 11, fill: 'var(--color-muted-foreground)', textAnchor: 'middle' }}
            />
          </YAxis>
          <Tooltip
            labelFormatter={(l) => fmtDate(String(l))}
            formatter={(value: unknown, name: unknown) => {
              if ((name === 'band' || name === 'bandExtrap') && Array.isArray(value)) {
                return [
                  `${fmtY(Number(value[0]))} – ${fmtY(Number(value[1]))}`,
                  name === 'bandExtrap' ? 'Faixa (extrapolada)' : 'Faixa (lo–hi)',
                ];
              }
              if (name === 'sim') return [fmtY(Number(value)), overlayLabel];
              return [fmtY(Number(value)), valLabel];
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
          {/* Extrapolated tail (beyond the model horizon): greyed so it reads as less certain */}
          <Area
            dataKey="bandExtrap"
            stroke="none"
            fill="var(--color-muted-foreground)"
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
              stroke={overlayColor}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
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
          {horizonBoundary && (
            <ReferenceLine
              x={horizonBoundary}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="1 3"
              label={{
                value: 'limite do modelo',
                fill: 'var(--color-muted-foreground)',
                fontSize: 9,
                position: 'insideTopRight',
              }}
            />
          )}
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
    </div>
  );
}
