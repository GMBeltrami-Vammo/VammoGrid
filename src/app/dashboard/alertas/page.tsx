'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  XCircle,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { useAlerts } from '@/hooks/useAlerts';
import { HUBS } from '@/constants/hubs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Alert, HubId } from '@/types';

function hubNames(hubs: HubId[]): string {
  return hubs.map((h) => HUBS[h]?.name ?? h).join(', ');
}

function AlertSection({
  title,
  description,
  icon,
  accent,
  alerts,
  render,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
  alerts: Alert[];
  render: (a: Alert) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-lg border bg-card">
      {/* Clickable header — toggles the body open/closed */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span
          className={`ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${accent}`}
        >
          {alerts.length}
        </span>
      </button>

      {open && (
        <div className="border-t">
          <p className="px-4 pt-3 text-xs text-muted-foreground">{description}</p>
          <div className="p-4 pt-2">
            {alerts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum alerta neste tipo. ✓
              </p>
            ) : (
              <ul className="divide-y">{alerts.map(render)}</ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function AlertasPage() {
  const { byType, total, isLoading, isError } = useAlerts();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Alertas</h1>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alertas</h1>
        <p className="mt-2 text-sm text-destructive">
          Erro ao carregar dados de estoque.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Alertas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total === 0
            ? 'Nenhum alerta ativo. Tudo sob controle.'
            : `${total} alerta${total > 1 ? 's' : ''} ativo${total > 1 ? 's' : ''} (respeitando seu filtro global).`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Tipo 1 — DOH < 3 */}
        <AlertSection
          title="Tipo 1 · DOH crítico (< 3 dias)"
          description="SKUs cuja cobertura de estoque é menor que 3 dias em algum centro."
          icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
          accent="bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
          alerts={byType.doh_critical}
          render={(a) => (
            <li key={a.skuId} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.skuName}</p>
                <p className="text-xs text-muted-foreground">{hubNames(a.hubs)}</p>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">
                {a.doh}d
              </span>
            </li>
          )}
        />

        {/* Tipo 2 — hub stock = 0 */}
        <AlertSection
          title="Tipo 2 · Centro zerado"
          description="SKUs com estoque igual a 0 em pelo menos um centro."
          icon={<AlertCircle className="h-4 w-4 text-amber-500" />}
          accent="bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          alerts={byType.hub_zero}
          render={(a) => (
            <li key={a.skuId} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.skuName}</p>
                <p className="text-xs text-muted-foreground">
                  Zerado em: {hubNames(a.hubs)}
                </p>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                {a.hubs.length}/3
              </span>
            </li>
          )}
        />

        {/* Tipo 3 — total stock = 0 */}
        <AlertSection
          title="Tipo 3 · Estoque total zerado"
          description="SKUs sem nenhuma unidade em estoque em qualquer centro."
          icon={<XCircle className="h-4 w-4 text-rose-600" />}
          accent="bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
          alerts={byType.total_zero}
          render={(a) => (
            <li key={a.skuId} className="flex items-center justify-between py-2">
              <p className="truncate text-sm font-medium">{a.skuName}</p>
              <span className="ml-2 shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                0 un
              </span>
            </li>
          )}
        />

        {/* Tipo 4 — high-consumption days */}
        <AlertSection
          title="Tipo 4 · Pico de consumo no dia"
          description="Dias em que o consumo passou de 1,5× a média diária (L30D) e teve pelo menos 3 unidades. Um alerta por dia, com estoque atual e consumo médio mensal."
          icon={<TrendingUp className="h-4 w-4 text-purple-500" />}
          accent="bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
          alerts={byType.consumption_spike}
          render={(a) => (
            <li
              key={`${a.skuId}-${a.hubs[0]}-${a.daySort}`}
              className="flex items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.skuName}</p>
                <p className="text-xs text-muted-foreground">
                  {hubNames(a.hubs)} · {a.dayLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.dayQty} un no dia · estoque atual {a.currentStock} · média{' '}
                  {a.monthlyConsumption}/mês
                </p>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                {a.avg ? `${((a.dayQty ?? 0) / a.avg).toFixed(1)}×` : '—'}
              </span>
            </li>
          )}
        />
      </div>

      {byType.total_zero.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Nota: o Tipo 3 depende de incluir SKUs com estoque total zerado na
          questão Metabase #29571 (hoje ela filtra <code>qty_total &gt; 0</code>).
        </p>
      )}
    </div>
  );
}
