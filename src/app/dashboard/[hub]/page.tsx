'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { use } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@base-ui/react';
import { HUBS } from '@/constants/hubs';
import { useHubInventory } from '@/hooks/useInventory';
import { useItemConsumption } from '@/hooks/useConsumption';
import { useInventoryHistory } from '@/hooks/useInventoryHistory';
import { InventoryTable } from '@/components/inventory/InventoryTable';
import { ConsumptionBarChart } from '@/components/charts/ConsumptionBarChart';
import { DohBadge } from '@/components/inventory/DohBadge';
import { Badge } from '@/components/ui/badge';
import type { HubId, InventoryItem } from '@/types';

// ─── Chart modal ────────────────────────────────────────────────────────────

function ChartModal({
  item,
  open,
  onClose,
}: {
  item: InventoryItem;
  open: boolean;
  onClose: () => void;
}) {
  const { data: records = [], isLoading: loadingConsumption } =
    useItemConsumption(item.skuName, item.hubId);

  const { data: history = [], isLoading: loadingHistory } =
    useInventoryHistory(item.skuName, item.hubId);

  const isLoading = loadingConsumption || loadingHistory;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Backdrop
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm
                     data-[ending-style]:opacity-0 data-[starting-style]:opacity-0
                     transition-opacity duration-200"
        />

        {/* Popup — centred, wide */}
        <Dialog.Popup
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="w-full max-w-4xl rounded-xl border bg-background shadow-2xl
                       data-[ending-style]:scale-95 data-[starting-style]:scale-95
                       data-[ending-style]:opacity-0 data-[starting-style]:opacity-0
                       transition-all duration-200"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b px-6 py-4">
              <div className="space-y-1">
                <Dialog.Title className="text-base font-semibold leading-none">
                  {item.skuName}
                </Dialog.Title>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {item.skuId}
                  </span>
                  <DohBadge doh={item.doh} status={item.dohStatus} showDays />
                </div>
              </div>
              <Dialog.Close
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              {isLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    Carregando dados...
                  </p>
                </div>
              ) : (
                <ConsumptionBarChart
                  records={records}
                  history={history}
                  itemGroup={item.skuName}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-between border-t px-6 py-3 text-xs text-muted-foreground">
              <span>
                Estoque atual: <strong className="text-foreground">{item.qtyAvailable} un</strong>
              </span>
              <span>Últimos 30 dias · Maestro OS</span>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Hub page ───────────────────────────────────────────────────────────────

export default function HubPage({
  params,
}: {
  params: Promise<{ hub: string }>;
}) {
  const { hub: hubSlug } = use(params);
  const hub = HUBS[hubSlug as HubId];

  if (!hub) notFound();

  const { data: items = [], isLoading, isError } = useHubInventory(hub.id);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const criticalCount = items.filter((i) => i.dohStatus === 'critical').length;
  const warningCount  = items.filter((i) => i.dohStatus === 'warning').length;

  function handleRowSelect(item: InventoryItem) {
    setSelectedItem(item);
    setDialogOpen(true);
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{hub.name}</h1>
          {hub.isRecoveryCenter && (
            <Badge
              variant="outline"
              className="text-emerald-600 border-emerald-300"
            >
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
              <span className="text-sm text-emerald-600 font-medium">
                Estoque OK
              </span>
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

      {/* Inventory table — click a row to open the chart modal */}
      <InventoryTable
        items={items}
        isLoading={isLoading}
        onRowSelect={handleRowSelect}
        selectedSkuId={selectedItem?.skuId}
      />

      {/* Chart modal */}
      {selectedItem && (
        <ChartModal
          item={selectedItem}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
