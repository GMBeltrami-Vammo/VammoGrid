'use client';

import { useState, useTransition } from 'react';
import type { TransportModal } from '@/types/planning';
import { updateLeadTimePolicy } from '@/app/dashboard/lead-times/actions';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

// Single-SKU lead-time editor for the SKU cadastro (review item 4a — folds the
// standalone Lead Times screen into the cadastro). Reuses the exact action the bulk
// table uses (updateLeadTimePolicy); the default modal selects the effective lead the
// purchase engine reads. Read-only for non-Heads.

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

export function LeadTimePanel({
  skuBase,
  seaDays,
  airDays,
  defaultModal,
  stdDays,
  isNational,
  isHead,
}: {
  skuBase: string;
  seaDays: number;
  airDays: number;
  defaultModal: TransportModal;
  stdDays: number | null;
  isNational: boolean;
  isHead: boolean;
}) {
  const [sea, setSea] = useState(seaDays);
  const [air, setAir] = useState(airDays);
  const [modal, setModal] = useState<TransportModal>(defaultModal);
  const [std, setStd] = useState<string>(stdDays != null ? String(stdDays) : '');
  const [national, setNational] = useState(isNational);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const effective = modal === 'air' ? air : sea;
  const stdVal = std.trim() === '' ? null : clamp(Number(std), 0, 365);
  const dirty =
    sea !== seaDays ||
    air !== airDays ||
    modal !== defaultModal ||
    stdVal !== stdDays ||
    national !== isNational;

  function save() {
    setStatus('saving');
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateLeadTimePolicy(skuBase, {
          seaDays: sea,
          airDays: air,
          defaultModal: modal,
          stdDays: stdVal,
          isNational: national,
        });
        if (res.ok) {
          setStatus('saved');
          setTimeout(() => setStatus('idle'), 3000);
        } else {
          setStatus('error');
          setError(res.error ?? 'Erro desconhecido');
        }
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Erro desconhecido');
      }
    });
  }

  // Non-Head: read-only summary.
  if (!isHead) {
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-1">Lead time <InfoHint id="lead-time" /></span> · {national ? 'nacional' : 'importado'}
        </p>
        <p className="mt-1 text-sm text-foreground">
          Marítimo <span className="font-semibold tabular-nums">{sea}d</span> · Aéreo{' '}
          <span className="font-semibold tabular-nums">{air}d</span> · padrão{' '}
          <span className="font-semibold">{modal === 'air' ? 'aéreo' : 'marítimo'}</span> → efetivo{' '}
          <span className="font-semibold tabular-nums">{effective}d</span>
          {stdVal != null && <> · σ {stdVal}d</>}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span className="inline-flex items-center gap-1">Lead time efetivo <InfoHint id="lead-time" /></span>
          </p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-foreground">
            {effective}
            <span className="ml-1 text-sm font-medium text-muted-foreground">dias</span>
          </p>
        </div>

        {/* Origem nacional/importado */}
        <label className="block text-xs font-medium text-muted-foreground">
          Origem
          <div className="mt-1 flex gap-0.5 rounded-md bg-muted/60 p-0.5">
            {([false, true] as boolean[]).map((nat) => (
              <button
                key={String(nat)}
                onClick={() => setNational(nat)}
                className={cn(
                  'rounded px-3 py-1 text-[11px] font-medium transition-colors',
                  national === nat ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {nat ? 'Nacional' : 'Importado'}
              </button>
            ))}
          </div>
        </label>

        {/* Marítimo / Aéreo / σ */}
        <label className="block text-xs font-medium text-muted-foreground">
          Marítimo (d)
          <input
            type="number"
            min={1}
            max={365}
            value={sea}
            onChange={(e) => setSea(clamp(Number(e.target.value), 1, 365))}
            className="mt-1 block h-8 w-20 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Aéreo (d)
          <input
            type="number"
            min={1}
            max={365}
            value={air}
            onChange={(e) => setAir(clamp(Number(e.target.value), 1, 365))}
            className="mt-1 block h-8 w-20 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1">σ LT (d) <InfoHint id="sigma-l" /></span>
          <input
            type="number"
            min={0}
            max={365}
            value={std}
            placeholder="—"
            onChange={(e) => setStd(e.target.value)}
            className="mt-1 block h-8 w-20 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40"
          />
        </label>

        {/* Modal padrão */}
        <label className="block text-xs font-medium text-muted-foreground">
          Modal padrão
          <div className="mt-1 flex gap-0.5 rounded-md bg-muted/60 p-0.5">
            {(['sea', 'air'] as TransportModal[]).map((m) => (
              <button
                key={m}
                onClick={() => setModal(m)}
                className={cn(
                  'rounded px-3 py-1 text-[11px] font-medium transition-colors',
                  modal === m ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'sea' ? 'Marítimo' : 'Aéreo'}
              </button>
            ))}
          </div>
        </label>

        <button
          onClick={save}
          disabled={!dirty || isPending}
          className="h-8 rounded-md bg-brand-500/15 px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'saving' ? 'Salvando…' : status === 'saved' ? 'Salvo ✓' : status === 'error' ? 'Erro ✗' : 'Salvar'}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        O modal padrão define o lead efetivo usado no ROP, no “comprar até” e na data sugerida de pedido.
      </p>

      {status === 'error' && error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
