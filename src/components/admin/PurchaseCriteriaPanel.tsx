'use client';

import { useEffect, useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useServiceLevel } from '@/hooks/useServiceLevel';
import { setPurchaseCriteria } from '@/app/dashboard/admin/globalSettingsActions';
import type { PurchaseCriteriaMode } from '@/lib/planning/constants';
import { cn } from '@/lib/utils';

// Purchase/request criteria (admin). One choice, applied everywhere a SKU is judged to
// "need an order": the Compras "Novo Pedido" list AND the Semanas heatmap low-coloring.
//   • DOH: request when projected coverage drops below N days (editable).
//   • Estoque mínimo + segurança: request when projected stock drops below the ROP.
const MODES: { id: PurchaseCriteriaMode; title: string; desc: string }[] = [
  { id: 'doh', title: 'DOH mínimo na timeline', desc: 'Pedir quando a cobertura projetada cair abaixo de N dias.' },
  { id: 'rop', title: 'Estoque mínimo + segurança', desc: 'Pedir quando o estoque projetado cair abaixo do ponto de recompra.' },
];

export function PurchaseCriteriaPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data, isLoading, isError } = useServiceLevel();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const criteria = data?.purchaseCriteria;
  const [mode, setMode] = useState<PurchaseCriteriaMode>('doh');
  const [doh, setDoh] = useState(75);

  // Sync local editor state once the server value arrives.
  useEffect(() => {
    if (criteria) {
      setMode(criteria.mode);
      setDoh(criteria.dohThreshold);
    }
  }, [criteria]);

  const dirty = criteria ? mode !== criteria.mode || (mode === 'doh' && doh !== criteria.dohThreshold) : false;

  const save = () => {
    if (!isHead) return;
    setError(null);
    startTransition(async () => {
      const res = await setPurchaseCriteria({ mode, dohThreshold: doh });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['global-settings'] });
      } else {
        setError(res.error ?? 'Erro ao salvar critério.');
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Critério de compra (global)</h2>
        <p className="text-sm text-muted-foreground">
          Quando um SKU <b>precisa de pedido</b> — usado na aba <b>Novo Pedido</b> e para colorir o heatmap de <b>Semanas</b>.
        </p>
      </div>

      {error && <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>}

      {isLoading ? (
        <Skeleton className="h-20 w-full max-w-md" />
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar o critério.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => {
              const isActive = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => isHead && setMode(m.id)}
                  disabled={!isHead || pending}
                  aria-pressed={isActive}
                  className={cn(
                    'flex min-w-[14rem] max-w-xs flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
                    isActive ? 'border-brand-500 bg-brand-500/10' : 'border-border bg-card hover:bg-muted/40',
                    (!isHead || pending) && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <span className="text-sm font-semibold">{m.title}</span>
                  <span className="mt-0.5 text-xs text-muted-foreground">{m.desc}</span>
                </button>
              );
            })}
          </div>

          {mode === 'doh' && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">DOH mínimo:</span>
              <input
                type="number"
                min={1}
                value={doh}
                disabled={!isHead || pending}
                onChange={(e) => setDoh(Number(e.target.value))}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500 disabled:opacity-70"
              />
              <span className="text-muted-foreground">dias</span>
            </label>
          )}

          {isHead && (
            <button
              onClick={save}
              disabled={!dirty || pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
            >
              <Check size={15} /> {pending ? 'Salvando…' : 'Salvar critério'}
            </button>
          )}
        </>
      )}

      {!isHead && <p className="text-xs text-muted-foreground">Somente Heads podem alterar o critério.</p>}
    </div>
  );
}
