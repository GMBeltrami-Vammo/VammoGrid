'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPrepStatus } from '@/app/dashboard/pedidos/actions';
import { PREP_STATUS_LABELS, PREP_STATUS_ORDER } from './orderMeta';
import type { PrepStatus } from '@/types';
import { cn } from '@/lib/utils';

// Advance a draft pedido along elaborado → enviado → feito (D1/D2). Head-only.
// Applies to every line row sharing the pedido (the caller passes all ids).
export function PrepStatusControl({
  ids,
  current,
  isHead,
}: {
  ids: string[];
  current: PrepStatus | null;
  isHead: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!current) return null; // not a draft (normal/legacy order) — no prep controls

  const choose = (next: PrepStatus) => {
    if (!isHead || next === current || pending) return;
    setError(null);
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => setPrepStatus(id, next)));
      const failed = results.find((r) => !r.ok);
      if (failed) setError(failed.error ?? 'Erro ao mudar o estágio.');
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {PREP_STATUS_ORDER.map((stage, i) => {
          const done = PREP_STATUS_ORDER.indexOf(current) >= i;
          return (
            <div key={stage} className="flex items-center gap-1">
              <button
                onClick={() => choose(stage)}
                disabled={!isHead || pending}
                aria-current={stage === current}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  stage === current
                    ? 'bg-brand-500 text-white'
                    : done
                      ? 'bg-brand-500/15 text-brand-600'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                  (!isHead || pending) && 'cursor-not-allowed opacity-70',
                )}
              >
                {PREP_STATUS_LABELS[stage]}
              </button>
              {i < PREP_STATUS_ORDER.length - 1 && <span className="text-muted-foreground/40">→</span>}
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-alert-error">{error}</p>}
    </div>
  );
}
