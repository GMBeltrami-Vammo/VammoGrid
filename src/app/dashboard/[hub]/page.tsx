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
import { useApplyFilter } from '@/lib/filter/FilterContext';
import { InventoryTable } from '@/components/inventory/InventoryTable';
import { MonthlyClosingTable } from '@/components/inventory/MonthlyClosingTable';
import { ConsumptionBarChart } from '@/components/charts/ConsumptionBarChart';
import { DohBadge } from '@/components/inventory/DohBadge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-200" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-xl border bg-background shadow-2xl data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-all duration-200">
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
              <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div className="px-6 py-5">
              {isLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <p className="text-sm text-muted-foreground">Carregando dados...</p>
                </div>
              ) : (
                <ConsumptionBarChart
                  records={records}
                  history={history}
                  itemGroup={item.skuName}
                />
              )}
            </div>

            <div className="flex justify-between border-t px-6 py-3 text-xs text-muted-foreground">
              <span>
                Estoque atual:{' '}
                <strong className="text-foreground">{item.qtyAvailable} un</strong>
              </span>
              <span>Últimos 30 dias · Maestro OS</span>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ hubId }: { hubId: HubId }) {
  const { data: rawItems = [], isLoading } = useHubInventory(hubId);
  const items = useApplyFilter(rawItems);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleRowSelect(item: InventoryItem) {
    setSelectedItem(item);
    setDialogOpen(true);
  }

  return (
    <>
      <InventoryTable
        items={items}
        isLoading={isLoading}
        onRowSelect={handleRowSelect}
        selectedSkuId={selectedItem?.skuId}
      />
      {selectedItem && (
        <ChartModal
          item={selectedItem}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

// ─── Hub page ───────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'closing';

export default function HubPage({
  params,
}: {
  params: Promise<{ hub: string }>;
}) {
  const { hub: hubSlug } = use(params);
  const hub = HUBS[hubSlug as HubId];

  if (!hub) notFound();

  const [tab, setTab] = useState<TabKey>('overview');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Visão Geral' },
    { key: 'closing', label: 'Fechamento do Mês' },
  ];

  return (
    <div>
      {/* Page header */}
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{hub.name}</h1>
          {hub.isRecoveryCenter && (
            <Badge variant="outline" className="text-brand-600 border-brand-300">
              Centro de Recuperação
            </Badge>
          )}
        </div>
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
                ? 'border-brand-600 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' ? (
        <OverviewTab hubId={hub.id} />
      ) : (
        <MonthlyClosingTable hubId={hub.id} />
      )}
    </div>
  );
}
