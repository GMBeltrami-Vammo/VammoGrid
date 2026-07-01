'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Pencil, X } from 'lucide-react';
import { HUB_LIST } from '@/constants/planningHubs';
import { setHubMaxStock } from '@/app/dashboard/sku/[sku]/hubMaxStockActions';
import { fmtInt } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import type { HubId } from '@/types/planning';

// Per-SKU/hub maximum stock caps (sub-project B3). Visibility + alert only: shows
// current on-hand vs. the configured cap and flags hubs over the cap. Editing is
// Head-only; it never affects the purchase engine's order math.
export function HubMaxStockPanel({
  skuBase,
  byHub,
  caps,
  isHead,
}: {
  skuBase: string;
  byHub: Record<HubId, number>;
  caps: Partial<Record<HubId, number>>;
  isHead: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<HubId | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (hub: HubId) => {
    setEditing(hub);
    setDraft(caps[hub] != null ? String(caps[hub]) : '');
    setError(null);
  };

  const save = (hub: HubId) => {
    const trimmed = draft.trim();
    const max = trimmed === '' ? null : Number(trimmed);
    if (max != null && (!Number.isFinite(max) || max < 0)) {
      setError('Valor inválido.');
      return;
    }
    startTransition(async () => {
      const res = await setHubMaxStock(skuBase, hub, max);
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao salvar.');
      }
    });
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Estoque máximo por hub
        </p>
        <span className="text-[11px] text-muted-foreground/70">
          alerta apenas — não altera a sugestão de compra
        </span>
      </div>
      {error && <p className="mb-2 text-xs text-alert-error">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {HUB_LIST.map((h) => {
          const cap = caps[h.id];
          const onHand = byHub[h.id];
          const over = cap != null && onHand > cap;
          return (
            <div
              key={h.id}
              className={cn(
                'rounded-lg border p-3 text-sm',
                over ? 'border-alert-warning/40 bg-alert-warning/5' : 'border-border bg-card',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.name}</span>
                {over && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-alert-warning">
                    <AlertTriangle size={12} /> acima do teto
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between tabular-nums">
                <span className="text-muted-foreground">
                  {fmtInt(onHand)} / {cap != null ? fmtInt(cap) : '—'}
                </span>
                {isHead &&
                  (editing === h.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="sem teto"
                        className="h-6 w-20 rounded border border-input bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
                      />
                      <button onClick={() => save(h.id)} disabled={pending} aria-label="Salvar" className="text-alert-success">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditing(null)} disabled={pending} aria-label="Cancelar" className="text-muted-foreground">
                        <X size={14} />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => start(h.id)}
                      aria-label={`Editar teto ${h.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil size={13} />
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
