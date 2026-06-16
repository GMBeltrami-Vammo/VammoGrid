'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ShieldCheck, Lock } from 'lucide-react';
import { FleetInfoPanel } from '@/components/admin/FleetInfoPanel';
import { RecoveryParamsPanel } from '@/components/admin/RecoveryParamsPanel';
import { cn } from '@/lib/utils';

type TabKey = 'fleet' | 'recovery';

export default function AdminPage() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const [tab, setTab] = useState<TabKey>('fleet');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'fleet', label: 'Frota' },
    { key: 'recovery', label: 'Recuperação' },
  ];

  return (
    <div>
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Configuração
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Frota e parâmetros de recuperação por SKU
        </p>
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

      <div className="mb-4 flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-brand-500 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'fleet' ? <FleetInfoPanel /> : <RecoveryParamsPanel />}
    </div>
  );
}
