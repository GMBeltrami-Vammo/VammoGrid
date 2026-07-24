'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Recycle } from 'lucide-react';
import { useSkuSummary } from '@/hooks/useSkuSummary';
import { ForecastSourceBadge } from './ForecastSourceBadge';
import { fmtDate, fmtInt, fmtNum } from '@/lib/planning/format';
import { cn } from '@/lib/utils';

const ProjectionChart = dynamic(
  () => import('./ProjectionChart').then((m) => ({ default: m.ProjectionChart })),
  { ssr: false, loading: () => <div className="h-[240px] animate-pulse rounded-lg bg-muted/40" /> },
);

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'default' }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums', tone === 'danger' ? 'text-alert-error' : 'text-foreground')}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SkuPopup({
  skuBase,
  open,
  onClose,
  labelId,
}: {
  skuBase: string | null;
  open: boolean;
  onClose: () => void;
  labelId: string;
}) {
  const { data, isLoading, isError, error } = useSkuSummary(skuBase, open);

  return (
    <div className="max-h-[85vh] overflow-y-auto p-5">
      {/* Header */}
      <div className="mb-4 pr-8">
        <p className="font-mono text-xs text-brand-500">{skuBase}</p>
        <h2 id={labelId} className="text-lg font-semibold leading-tight">
          {data?.found ? data.skuName : skuBase}
        </h2>
        {data?.found && data.provenance.source && (
          <div className="mt-1.5">
            <ForecastSourceBadge
              source={data.provenance.source}
              asOfDate={data.provenance.asOfDate}
              modelVersion={data.provenance.modelVersion}
            />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando resumo…
        </div>
      )}

      {isError && (
        <div className="flex h-40 items-center justify-center gap-2 rounded-lg bg-alert-error/10 px-4 text-sm text-alert-error">
          <AlertTriangle className="size-4" /> {error instanceof Error ? error.message : 'Erro ao carregar o resumo.'}
        </div>
      )}

      {data && !data.found && !isLoading && (
        <p className="rounded-lg bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Sem dados para este SKU (ou a fonte de dados não está configurada).
        </p>
      )}

      {data?.found && (
        <>
          {/* KPIs */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Estoque" value={fmtInt(data.kpis.stock)} />
            <Stat label="Cobertura (DOH)" value={data.kpis.dohNow != null ? `${fmtInt(data.kpis.dohNow)}d` : '—'} />
            <Stat label="Consumo/dia" value={fmtNum(data.kpis.dailyDemand)} hint="méd. 30d" />
            <Stat
              label="Ruptura"
              value={data.kpis.stockoutDate ? fmtDate(data.kpis.stockoutDate) : '—'}
              tone={data.kpis.stockoutDate ? 'danger' : 'default'}
            />
          </div>

          {/* Recovery line */}
          <p className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Recycle className="size-3.5" />
            {data.kpis.isRepairable
              ? `Recuperável — ${(data.kpis.recoveryRate * 100).toFixed(0)}% em ${fmtInt(data.kpis.recoveryTurnaroundDays)}d`
              : 'Não recuperável'}
          </p>

          {/* Chart D-7 → D+30 (with L30/L90 faded lines + DOH toggle) */}
          <div className="mb-4 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Estoque · D-7 → D+30
            </p>
            <ProjectionChart
              timeline={data.projection}
              rateSource={data.rateSource}
              comparisons={data.comparisons}
              arrivals={data.arrivals}
              history={data.history.length > 0 ? data.history : undefined}
              stockoutDate={data.kpis.stockoutDate}
              height={220}
            />
          </div>

          {/* Next 8 weeks mini heatmap */}
          <MiniStrip strip={data.strip} arrivals={data.arrivals} today={data.today} floor={data.criteriaFloor} />

          {/* Footer */}
          <div className="mt-4 flex justify-end">
            <Link
              href={`/dashboard/estoque?sku=${encodeURIComponent(data.skuBase)}`}
              prefetch={false}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-400"
            >
              Ver página completa <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function MiniStrip({
  strip,
  arrivals,
  today,
  floor,
}: {
  strip: { weekIdx: number; offset: number; stock: number; doh: number | null; isLow: boolean; isOut: boolean }[];
  arrivals: { date: string; qty: number }[];
  today: string;
  floor: number;
}) {
  // Registered arrivals per week (offset/7 rounded), for the ▼ marker.
  const arrByWeek = new Map<number, number>();
  for (const a of arrivals) {
    const off = Math.round((Date.parse(a.date) - Date.parse(today)) / 86_400_000);
    if (off < 0) continue;
    const w = Math.round(off / 7);
    arrByWeek.set(w, (arrByWeek.get(w) ?? 0) + a.qty);
  }

  const cellClass = (c: { isOut: boolean; isLow: boolean }) =>
    c.isOut
      ? 'bg-alert-error/20 text-alert-error'
      : c.isLow
        ? 'bg-alert-warning/20 text-amber-700 dark:text-alert-warning'
        : 'bg-alert-success/15 text-alert-success';

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Próximas 8 semanas (DOH · piso {fmtInt(floor)}d)
      </p>
      <div className="grid grid-cols-8 gap-1">
        {strip.map((c) => {
          const arr = arrByWeek.get(c.weekIdx) ?? 0;
          return (
            <div key={c.weekIdx} className={cn('relative rounded-md px-1 py-1.5 text-center', cellClass(c))}>
              <p className="text-[9px] font-medium opacity-70">S{c.weekIdx + 1}</p>
              <p className="text-xs font-bold tabular-nums">{c.doh != null ? `${fmtInt(c.doh)}d` : '—'}</p>
              {arr > 0 && (
                <p
                  className="inline-flex items-center justify-center text-[8px] font-semibold text-brand-600"
                  title={`Pedido chega: +${fmtInt(arr)}`}
                >
                  <ChevronDown className="size-2.5" />
                  {fmtInt(arr)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
