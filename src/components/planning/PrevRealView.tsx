'use client';

import dynamic from 'next/dynamic';
import { SkuLink } from '@/components/planning/SkuLink';
import type { PrevRealPoint } from '@/lib/planning/prevReal';

// Previsão × Realizado per SKU (review 8 fase 2): demand (previsto vs consumido) and
// stock (projetado vs on-hand real). Recharts lazy-loaded via the Inner split.

const PrevRealChartInner = dynamic(() => import('./PrevRealChartInner'), {
  ssr: false,
  loading: () => <div className="h-[240px] animate-pulse rounded-lg bg-muted/40" />,
});

export interface PrevRealSku {
  skuBase: string;
  skuName: string | null;
  demand: PrevRealPoint[];
  stock: PrevRealPoint[];
  demandRatio: number | null;
}

export function PrevRealView({ skus }: { skus: PrevRealSku[] }) {
  if (skus.length === 0) {
    return (
      <p className="rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Sem dados suficientes para comparar (o pedido precisa de uma base de elaboração congelada).
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {skus.map((s) => (
        <div key={s.skuBase} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <SkuLink
              skuBase={s.skuBase}
              className="font-medium text-brand-600 hover:underline"
            >
              {s.skuName ?? s.skuBase}
            </SkuLink>
            <span className="font-mono text-[11px] text-muted-foreground">{s.skuBase}</span>
            {s.demandRatio != null && (
              <span
                className="ml-auto text-xs text-muted-foreground"
                title="Consumo realizado ÷ previsto no período decorrido"
              >
                Realizado vs previsto:{' '}
                <span className="font-semibold text-foreground">{Math.round(s.demandRatio * 100)}%</span>
              </span>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Demanda diária (un)
              </p>
              <PrevRealChartInner data={s.demand} prevLabel="Previsto" realLabel="Consumo real" />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Estoque (un)
              </p>
              {s.stock.length > 0 ? (
                <PrevRealChartInner data={s.stock} prevLabel="Projetado" realLabel="Estoque real" />
              ) : (
                <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  Sem histórico de estoque no período.
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
