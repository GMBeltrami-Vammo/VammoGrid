'use client';

import { useMemo, useState } from 'react';
import type {
  HubId,
  OpenPurchaseOrder,
  SkuForecast,
  SkuPolicy,
  StockState,
  TransportModal,
} from '@/types/planning';
import dynamic from 'next/dynamic';
import { InfoHint } from '@/components/planning/InfoHint';
import { projectSku } from '@/lib/planning/projection';
import { addDays } from '@/lib/planning/dates';
import { scaleForecast, delayOrder } from '@/lib/planning/scenario';
import { fmtDate, fmtInt } from '@/lib/planning/format';

// Lazy-load the Recharts chart so it stays out of the initial JS bundle
// (vercel-react-best-practices: bundle-dynamic-imports).
const ProjectionChart = dynamic(
  () => import('./ProjectionChart').then((m) => ({ default: m.ProjectionChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-lg bg-muted/40" /> },
);

// Procurement what-if: re-runs the (pure) projection engine in the browser with a
// hypothetical inbound PO, overlaying the simulated curve on the baseline so the
// planner sees the averted stockout before approving. No server round-trip.

export function SkuSimulator({
  stock,
  forecast,
  orders,
  policy,
  shares,
  today,
  history,
}: {
  stock: StockState;
  forecast: SkuForecast | null;
  orders: OpenPurchaseOrder[];
  policy: SkuPolicy;
  shares: Record<HubId, number>;
  today: string;
  history?: { date: string; stock: number }[];
}) {
  const [qty, setQty] = useState(100);
  const [arrivalDays, setArrivalDays] = useState(policy.leadTimeDays);
  const [modal, setModal] = useState<TransportModal>('sea');
  const [demandPct, setDemandPct] = useState(0);
  const [delayDays, setDelayDays] = useState(0);

  const baseline = useMemo(
    () => projectSku({ stock, forecast, orders, policy, shares, today }).global,
    [stock, forecast, orders, policy, shares, today],
  );

  const simulated = useMemo(() => {
    const simForecast = forecast ? scaleForecast(forecast, demandPct) : null;
    const delayedOrders = orders.map((o) => delayOrder(o, delayDays));
    const simOrders: OpenPurchaseOrder[] =
      qty > 0
        ? [
            ...delayedOrders,
            {
              id: -1,
              vo: 'SIM',
              skuCode: stock.skuBase,
              skuBase: stock.skuBase,
              skuName: stock.skuName,
              qty,
              orderDate: today,
              eta: addDays(today, Math.max(0, arrivalDays)),
              leadTimeDays: arrivalDays,
              modal,
              status: 'ordered',
              hubId: 'osasco',
              source: 'sim',
            },
          ]
        : delayedOrders;
    return projectSku({ stock, forecast: simForecast, orders: simOrders, policy, shares, today }).global;
  }, [qty, arrivalDays, modal, demandPct, delayDays, stock, forecast, orders, policy, shares, today]);

  const averted =
    baseline.stockoutDate && !simulated.stockoutDate
      ? 'Ruptura evitada no horizonte'
      : baseline.stockoutDate && simulated.stockoutDate && simulated.stockoutDate > baseline.stockoutDate
        ? `Ruptura adiada de ${fmtDate(baseline.stockoutDate)} para ${fmtDate(simulated.stockoutDate)}`
        : baseline.stockoutDate
          ? 'Sem mudança na ruptura'
          : 'Sem ruptura prevista';

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="text-xs font-medium text-muted-foreground">
          Quantidade
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="mt-1 block h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Chega em (dias)
          <input
            type="number"
            min={0}
            value={arrivalDays}
            onChange={(e) => setArrivalDays(Number(e.target.value))}
            className="mt-1 block h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Modal
          <select
            value={modal}
            onChange={(e) => {
              const m = e.target.value as TransportModal;
              setModal(m);
              setArrivalDays(m === 'air' ? 30 : policy.leadTimeDays);
            }}
            className="mt-1 block h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
          >
            <option value="sea">Marítimo</option>
            <option value="air">Aéreo</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Demanda
          <select
            value={demandPct}
            onChange={(e) => setDemandPct(Number(e.target.value))}
            className="mt-1 block h-8 w-24 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
          >
            {[-20, -10, 0, 10, 20, 50].map((d) => (
              <option key={d} value={d}>
                {d > 0 ? `+${d}` : d}%
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Atrasar pedidos (d)
          <input
            type="number"
            value={delayDays}
            onChange={(e) => setDelayDays(Number(e.target.value) || 0)}
            className="mt-1 block h-8 w-24 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
          />
        </label>
        <div className="ml-auto text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Resultado <InfoHint id="stockout-date" />
          </p>
          <p className="text-sm font-semibold text-alert-success">{averted}</p>
        </div>
      </div>

      <ProjectionChart
        timeline={baseline.timeline}
        overlayTimeline={simulated.timeline}
        overlayLabel={`+${fmtInt(qty)} un (${modal === 'air' ? 'aéreo' : 'marítimo'})`}
        stockoutDate={baseline.stockoutDate}
        history={history}
        height={300}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Linha cheia = projeção atual <InfoHint id="projection-line" /> · tracejada verde = cenário simulado{' '}
        <InfoHint id="recovery-line" />
        {qty > 0 ? ` (pedido +${fmtInt(qty)} un em ${arrivalDays}d` : ' ('}
        {demandPct !== 0 ? `, demanda ${demandPct > 0 ? '+' : ''}${demandPct}%` : ''}
        {delayDays !== 0 ? `, atraso pedidos ${delayDays}d` : ''}). Simulação local — não afeta produção.
      </p>
    </div>
  );
}
