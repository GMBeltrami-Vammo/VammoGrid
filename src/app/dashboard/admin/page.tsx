'use client';

import { useSession } from 'next-auth/react';
import { ShieldCheck, Lock } from 'lucide-react';
import { FleetInfoPanel } from '@/components/admin/FleetInfoPanel';
import { ServiceLevelPanel } from '@/components/admin/ServiceLevelPanel';
import { cn } from '@/lib/utils';

// The "Recuperação" tab (fleet.sku_params + Metabase-backed consumption display) was
// retired: the engine never read sku_params — recovery config lives in
// fleet.sku_policy, edited from the Estoque page's RecoveryPanel.

export default function AdminPage() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;

  return (
    <div>
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Configuração
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Frota</p>
      </div>

      <div
        className={cn(
          'mb-4 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium',
          isHead
            ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {isHead ? <ShieldCheck size={13} /> : <Lock size={13} />}
        {isHead
          ? 'Você é Head — pode editar estes dados.'
          : 'Somente leitura — apenas Heads podem editar.'}
      </div>

      <div className="space-y-8">
        <ServiceLevelPanel />
        <div className="h-px bg-border" />
        <FleetInfoPanel />
      </div>
    </div>
  );
}
