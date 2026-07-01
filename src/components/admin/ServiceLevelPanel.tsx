'use client';

import { useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Skeleton } from '@/components/ui/skeleton';
import { useServiceLevel } from '@/hooks/useServiceLevel';
import { setServiceLevelTier } from '@/app/dashboard/admin/globalSettingsActions';
import {
  SERVICE_LEVEL_LABEL,
  SERVICE_LEVEL_PCT,
  SERVICE_LEVEL_Z,
  type ServiceLevelTier,
} from '@/lib/planning/constants';
import { cn } from '@/lib/utils';

const TIERS: ServiceLevelTier[] = ['base', 'padrao', 'conservador'];

// Global service-level dial (sub-project B1). One choice, applied to every SKU's
// safety stock at once. Not A/B/C (that's the per-SKU importance class) — Base /
// Padrão / Conservador at 95 / 97 / 99%.
export function ServiceLevelPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data, isLoading, isError } = useServiceLevel();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = data?.serviceLevelTier;

  const choose = (tier: ServiceLevelTier) => {
    if (!isHead || tier === active) return;
    setError(null);
    startTransition(async () => {
      const res = await setServiceLevelTier(tier);
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['global-settings'] });
      } else {
        setError(res.error ?? 'Erro ao salvar nível de serviço.');
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Nível de serviço (global)</h2>
        <p className="text-sm text-muted-foreground">
          O piso de estoque de segurança aplicado a <b>todos os SKUs</b> de uma vez. Muda o{' '}
          <span className="font-mono">z</span> do cálculo <span className="font-mono">z·σ·√LT</span> na hora.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full max-w-md" />
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar o nível de serviço.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {TIERS.map((tier) => {
            const isActive = tier === active;
            return (
              <button
                key={tier}
                onClick={() => choose(tier)}
                disabled={!isHead || pending}
                aria-pressed={isActive}
                className={cn(
                  'flex min-w-[8rem] flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
                  isActive
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-border bg-card hover:bg-muted/40',
                  (!isHead || pending) && 'cursor-not-allowed opacity-70',
                )}
              >
                <span className="text-sm font-semibold">{SERVICE_LEVEL_LABEL[tier]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {SERVICE_LEVEL_PCT[tier]}% · z = {SERVICE_LEVEL_Z[tier].toLocaleString('pt-BR')}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!isHead && (
        <p className="text-xs text-muted-foreground">Somente Heads podem alterar o nível de serviço.</p>
      )}
    </div>
  );
}
