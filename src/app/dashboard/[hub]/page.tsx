'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { use } from 'react';
import { HUBS } from '@/constants/hubs';
import { useHubInventory } from '@/hooks/useInventory';
import { useSkuConsumption } from '@/hooks/useConsumption';
import { InventoryTable } from '@/components/inventory/InventoryTable';
import { ConsumptionBarChart } from '@/components/charts/ConsumptionBarChart';
import { Badge } from '@/components/ui/badge';
import type { HubId, InventoryItem } from '@/types';

function ChartSection({ item }: { item: InventoryItem }) {
  const { data: records = [], isLoading } = useSkuConsumption(item.skuId, item.hubId);

  if (isLoading) {
    return (
      <div className="mt-4 rounded-md border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">Carregando consumo...</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border bg-card p-4">
      <ConsumptionBarChart records={records} skuName={item.skuName} />
    </div>
  );
}

export default function HubPage({ params }: { params: Promise<{ hub: string }> }) {
  const { hub: hubSlug } = use(params);
  const hub = HUBS[hubSlug as HubId];

  if (!hub) notFound();

  const { data: items = [], isLoading, isError } = useHubInventory(hub.id);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const criticalCount = items.filter((i) => i.dohStatus === 'critical').length;
  const warningCount = items.filter((i) => i.dohStatus === 'warning').length;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{hub.name}</h1>
          {hub.isRecoveryCenter && (
            <Badge variant="outline" className="text-emerald-600 border-emerald-300">
              Centro de Recuperação
            </Badge>
          )}
        </div>

        {!isLoading && !isError && items.length > 0 && (
          <div className="flex gap-3 mt-2">
            {criticalCount > 0 && (
              <span className="text-sm text-red-600 font-medium">
                {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-sm text-yellow-600 font-medium">
                {warningCount} em atenção
              </span>
            )}
            {criticalCount === 0 && warningCount === 0 && (
              <span className="text-sm text-emerald-600 font-medium">Estoque OK</span>
            )}
          </div>
        )}

        {isError && (
          <p className="mt-2 text-sm text-destructive">
            Erro ao carregar dados. Verifique as credenciais do Metabase em{' '}
            <code className="font-mono text-xs">.env.local</code>.
          </p>
        )}
      </div>

      <InventoryTable
        items={items}
        isLoading={isLoading}
        onRowSelect={setSelectedItem}
        selectedSkuId={selectedItem?.skuId}
      />

      {selectedItem && <ChartSection item={selectedItem} />}
    </div>
  );
}
