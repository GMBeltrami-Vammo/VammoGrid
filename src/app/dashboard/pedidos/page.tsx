'use client';

import { useState } from 'react';
import { PurchaseOrdersPanel } from '@/components/orders/PurchaseOrdersPanel';
import { ProjectionPanel } from '@/components/orders/ProjectionPanel';
import { cn } from '@/lib/utils';

type TabKey = 'projection' | 'orders';

export default function PedidosPage() {
  const [tab, setTab] = useState<TabKey>('projection');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'projection', label: 'Projeção de estoque' },
    { key: 'orders', label: 'Pedidos' },
  ];

  return (
    <div>
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Planejamento
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos & Projeção</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pedidos de compra (VOs) e expectativa futura de estoque por SKU
        </p>
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

      {tab === 'projection' ? <ProjectionPanel /> : <PurchaseOrdersPanel />}
    </div>
  );
}
