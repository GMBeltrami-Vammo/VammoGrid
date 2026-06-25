'use client';

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import type { HistoricalRecovery, HubId, OpenPurchaseOrder, SkuForecast, SkuPolicy, StockState } from '@/types/planning';
import { projectSku } from '@/lib/planning/projection';
import { fmtDateLong, fmtInt, fmtNum } from '@/lib/planning/format';
import { updateRecoveryPolicy } from '@/app/dashboard/sku/[sku]/actions';
import { InfoHint } from '@/components/planning/InfoHint';

// Recovery panel: editable recovery params (rate, turnaround, is_repairable) +
// a what-if simulator that re-runs the projection engine client-side to show
// the impact of different recovery parameters on stock trajectory.

const ProjectionChart = dynamic(
  () => import('./ProjectionChart').then((m) => ({ default: m.ProjectionChart })),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-lg bg-muted/40" /> },
);

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function RecoveryPanel({
  skuBase,
  stock,
  forecast,
  orders,
  policy,
  shares,
  today,
  historicalRate,
  refreshedAt,
}: {
  skuBase: string;
  stock: StockState;
  forecast: SkuForecast | null;
  orders: OpenPurchaseOrder[];
  policy: SkuPolicy;
  shares: Record<HubId, number>;
  today: string;
  historicalRate?: HistoricalRecovery | null;
  /** When the weekly IMS recovery-rate refresh last ran (ISO). */
  refreshedAt?: string | null;
}) {
  // Editable policy state (matches current saved values on mount)
  const [rate, setRate] = useState(Math.round(policy.recoveryRate * 100));
  const [turnaround, setTurnaround] = useState(policy.recoveryTurnaroundDays);
  const [isRepairable, setIsRepairable] = useState(stock.isRepairable);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Simulator state (independent from the saved values above)
  const [simRate, setSimRate] = useState(Math.round(policy.recoveryRate * 100));
  const [simTurnaround, setSimTurnaround] = useState(policy.recoveryTurnaroundDays);
  const [simOpen, setSimOpen] = useState(false);

  // Baseline projection (current saved policy)
  const baseline = useMemo(
    () => projectSku({ stock, forecast, orders, policy, shares, today }).global,
    [stock, forecast, orders, policy, shares, today],
  );

  // Simulated projection (with simulator knobs)
  const simulated = useMemo(
    () =>
      projectSku({
        stock,
        forecast,
        orders,
        policy: {
          ...policy,
          recoveryRate: simRate / 100,
          recoveryTurnaroundDays: simTurnaround,
          isRepairable: true,
        },
        shares,
        today,
      }).global,
    [simRate, simTurnaround, stock, forecast, orders, policy, shares, today],
  );

  // Recovery units over next 30/90/150 days from the baseline timeline
  const recoveryAt = (days: number, tl: typeof baseline.timeline) =>
    tl.slice(1, days + 1).reduce((s, p) => s + (p.recovery ?? 0), 0);

  const baseRec30 = recoveryAt(30, baseline.timeline);
  const baseRec90 = recoveryAt(90, baseline.timeline);
  const simRec30 = recoveryAt(30, simulated.timeline);
  const simRec90 = recoveryAt(90, simulated.timeline);

  function handleSave() {
    setSaveStatus('saving');
    setSaveError(null);
    startTransition(async () => {
      try {
        const res = await updateRecoveryPolicy(skuBase, {
          recoveryRate: rate / 100,
          recoveryTurnaroundDays: turnaround,
          isRepairable,
        });
        if (res.ok) {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 3000);
        } else {
          setSaveStatus('error');
          setSaveError(res.error ?? 'Erro desconhecido');
        }
      } catch (e) {
        setSaveStatus('error');
        setSaveError(e instanceof Error ? e.message : 'Erro desconhecido');
      }
    });
  }

  const dirty =
    rate !== Math.round(policy.recoveryRate * 100) ||
    turnaround !== policy.recoveryTurnaroundDays ||
    isRepairable !== stock.isRepairable;

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 space-y-4">

      {refreshedAt && (
        <p className="text-[10px] text-muted-foreground">
          Taxas observadas (IMS) atualizadas em {fmtDateLong(refreshedAt.slice(0, 10))} · atualização semanal
        </p>
      )}

      {/* Editable params */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Parâmetros de recuperação
          </p>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Recuperável</span>
            <button
              role="switch"
              aria-checked={isRepairable}
              onClick={() => setIsRepairable((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition-colors ${isRepairable ? 'bg-brand-500' : 'bg-muted-foreground/30'}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isRepairable ? 'left-4' : 'left-0.5'}`}
              />
            </button>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-muted-foreground">
            Taxa de recuperação (%) <InfoHint id="recovery-rate" />
            <input
              type="number"
              min={0}
              max={100}
              value={rate}
              disabled={!isRepairable}
              onChange={(e) => setRate(clamp(Number(e.target.value), 0, 100))}
              className="mt-1 block h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500 disabled:opacity-40"
            />
            {historicalRate && (
              <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                Real (IMS {historicalRate.lookbackDays}d) <InfoHint id="recovery-observed" />:{' '}
                <span className="font-semibold text-foreground">
                  {Math.round(historicalRate.rate * 100)}%
                </span>{' '}
                <button
                  type="button"
                  onClick={() => setRate(clamp(Math.round(historicalRate.rate * 100), 0, 100))}
                  disabled={!isRepairable}
                  className="font-medium text-brand-600 hover:underline disabled:opacity-40"
                >
                  usar
                </button>
              </span>
            )}
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Turnaround (dias) <InfoHint id="recovery-turnaround" />
            <input
              type="number"
              min={1}
              max={365}
              value={turnaround}
              disabled={!isRepairable}
              onChange={(e) => setTurnaround(clamp(Number(e.target.value), 1, 365))}
              className="mt-1 block h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500 disabled:opacity-40"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={handleSave}
              disabled={!dirty || isPending}
              className="h-8 w-full rounded-md bg-brand-500/15 px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? 'Salvo ✓' : saveStatus === 'error' ? 'Erro ✗' : 'Salvar'}
            </button>
          </div>
        </div>
        {saveStatus === 'error' && saveError && (
          <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{saveError}</p>
        )}
      </div>

      {/* Historical rate from IMS ledger */}
      {historicalRate && (
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Taxa observada ({historicalRate.lookbackDays}d — IMS)
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground">Taxa real</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">{Math.round(historicalRate.rate * 100)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Recondicionados</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">{fmtInt(historicalRate.recovered)} un</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Consumidos</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">{fmtInt(historicalRate.consumed)} un</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            Taxa real medida no ledger do IMS: unidades recondicionadas ÷ consumidas nos últimos{' '}
            {historicalRate.lookbackDays} dias. Use-a como referência para definir a taxa de
            recuperação acima.
          </p>
        </div>
      )}

      {/* Recovery impact metrics from current projection */}
      {policy.isRepairable && (
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rec. 30d <InfoHint id="recovery-line" /></p>
            <p className="mt-0.5 text-base font-bold tabular-nums">{fmtInt(baseRec30)} un</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rec. 90d</p>
            <p className="mt-0.5 text-base font-bold tabular-nums">{fmtInt(baseRec90)} un</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Consumo/dia <InfoHint id="daily-demand" /></p>
            <p className="mt-0.5 text-base font-bold tabular-nums">{fmtNum(baseline.dailyDemand)} un</p>
          </div>
        </div>
      )}

      {/* Scenario simulator */}
      <div>
        <button
          onClick={() => setSimOpen((v) => !v)}
          className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          <span>Simular cenário de recuperação</span>
          <span>{simOpen ? '▲' : '▼'}</span>
        </button>

        {simOpen && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-4">
              <label className="text-xs font-medium text-muted-foreground">
                Taxa simulada (%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={simRate}
                  onChange={(e) => setSimRate(Number(e.target.value))}
                  className="mt-1 block w-40 accent-brand-500"
                />
                <span className="ml-1 text-foreground font-semibold">{simRate}%</span>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Turnaround simulado (dias)
                <input
                  type="range"
                  min={7}
                  max={90}
                  step={7}
                  value={simTurnaround}
                  onChange={(e) => setSimTurnaround(Number(e.target.value))}
                  className="mt-1 block w-40 accent-brand-500"
                />
                <span className="ml-1 text-foreground font-semibold">{simTurnaround}d</span>
              </label>

              <div className="ml-auto grid grid-cols-2 gap-x-4 gap-y-1 text-right">
                <div>
                  <p className="text-[10px] text-muted-foreground">Base 30d</p>
                  <p className="text-sm font-bold tabular-nums">{fmtInt(baseRec30)} un</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Sim 30d</p>
                  <p className="text-sm font-bold tabular-nums text-alert-success">{fmtInt(simRec30)} un</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Base 90d</p>
                  <p className="text-sm font-bold tabular-nums">{fmtInt(baseRec90)} un</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Sim 90d</p>
                  <p className="text-sm font-bold tabular-nums text-alert-success">{fmtInt(simRec90)} un</p>
                </div>
              </div>
            </div>

            <ProjectionChart
              timeline={baseline.timeline}
              overlayTimeline={simulated.timeline}
              overlayLabel={`Sim: ${simRate}% / ${simTurnaround}d`}
              stockoutDate={baseline.stockoutDate}
              height={220}
            />
            <p className="text-[10px] text-muted-foreground">
              Linha sólida = projeção atual · tracejada verde = com recuperação simulada ({simRate}% em {simTurnaround}d).
              Simulação local — não afeta produção.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
