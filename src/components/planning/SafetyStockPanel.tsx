'use client';

import { useState, useTransition } from 'react';
import type { AbcClass } from '@/types/planning';
import { ABC_Z } from '@/lib/planning/constants';
import { fmtInt, fmtNum } from '@/lib/planning/format';
import { updateSafetyStock } from '@/app/dashboard/sku/[sku]/actions';
import { InfoHint } from '@/components/planning/InfoHint';

// Safety stock is a GLOBAL (network-level) value per SKU. By default it's
// ABC_Z[class] × σ_L (σ_L from the forecast band); a manual override replaces it.
// It is the base of the purchase suggestion: ROP = demanda no lead + safety.

export function SafetyStockPanel({
  skuBase,
  abcClass,
  sigmaL,
  safetyOverride,
  expectedLeadTimeDemand,
  rop,
}: {
  skuBase: string;
  abcClass: AbcClass;
  sigmaL: number;
  /** Current saved override (null = use computed). */
  safetyOverride: number | null;
  expectedLeadTimeDemand: number;
  rop: number;
}) {
  const z = ABC_Z[abcClass];
  const computed = Math.round(z * sigmaL);

  const [value, setValue] = useState(safetyOverride != null ? String(safetyOverride) : '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = value.trim() === '' ? null : Math.max(0, Math.round(Number(value)));
  const isOverride = parsed != null && Number.isFinite(parsed);
  const effective = isOverride ? parsed : computed;
  const dirty = parsed !== safetyOverride;

  function save() {
    setStatus('saving');
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateSafetyStock(skuBase, parsed);
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

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* Effective value — prominent */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span className="inline-flex items-center gap-1">Estoque de segurança (global) <InfoHint id="safety" /></span>{isOverride ? ' · manual' : ' · calculado'}
          </p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-foreground">{fmtInt(effective)}<span className="ml-1 text-sm font-medium text-muted-foreground">un</span></p>
        </div>

        {/* Editable override */}
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Override manual (un)
            <input
              type="number"
              min={0}
              value={value}
              placeholder={`${computed} (calc.)`}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 block h-8 w-32 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand-500"
            />
          </label>
          {value.trim() !== '' && (
            <button
              onClick={() => setValue('')}
              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Voltar ao valor calculado"
            >
              limpar
            </button>
          )}
          <button
            onClick={save}
            disabled={!dirty || isPending}
            className="h-8 rounded-md bg-brand-500/15 px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'saving' ? 'Salvando…' : status === 'saved' ? 'Salvo ✓' : status === 'error' ? 'Erro ✗' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Formula */}
      <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
        SS calculado = Z(classe {abcClass} <InfoHint id="abc-class" /> = {z}) × σ_L <InfoHint id="sigma-l" /> ({fmtNum(sigmaL)}) = {fmtInt(computed)} un
        {isOverride && <span className="text-muted-foreground"> · override manual em uso ({fmtInt(parsed)} un)</span>}
      </p>

      {/* How it feeds the purchase suggestion */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Base da recompra: <span className="font-medium text-foreground">ROP <InfoHint id="rop" /> = demanda no lead <InfoHint id="expected-lead-demand" /> ({fmtInt(expectedLeadTimeDemand)}) + estoque de segurança ({fmtInt(effective)}) = {fmtInt(expectedLeadTimeDemand + effective)} un</span>
        {dirty ? ' — recalcula ao salvar.' : `. ROP atual: ${fmtInt(rop)} un.`}
      </p>

      {status === 'error' && error && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
