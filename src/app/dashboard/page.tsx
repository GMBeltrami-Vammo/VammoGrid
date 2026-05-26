import { HubSummaryCard } from '@/components/inventory/HubSummaryCard';
import { HUB_LIST } from '@/constants/hubs';

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estoque disponível e DOH por base
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HUB_LIST.map((hub) => (
          <HubSummaryCard key={hub.id} hub={hub} />
        ))}
      </div>
    </div>
  );
}
