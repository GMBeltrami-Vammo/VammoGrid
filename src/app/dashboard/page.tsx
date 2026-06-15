'use client';

import { useState } from 'react';
import { HubSummaryCard } from '@/components/inventory/HubSummaryCard';
import { FilterTable } from '@/components/inventory/FilterTable';
import { HUB_LIST } from '@/constants/hubs';
import { cn } from '@/lib/utils';

type TabKey = 'overview' | 'filter';

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>('overview');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Visão Geral' },
    { key: 'filter', label: 'Filtragem' },
  ];

  return (
    <div>
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Dashboard
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estoque disponível e DOH por base
        </p>
      </div>

      {/* Tabs */}
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

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HUB_LIST.map((hub) => (
            <HubSummaryCard key={hub.id} hub={hub} />
          ))}
        </div>
      ) : (
        <FilterTable />
      )}
    </div>
  );
}
