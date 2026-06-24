import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildWeekGrid } from '@/lib/planning/weekgrid';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { WeekGridView } from '@/components/planning/WeekGridView';

export const dynamic = 'force-dynamic';

export default async function SemanasPage() {
  const snap = await safeComputeSnapshot();

  if (snap.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Semanas" title="Projeção semanal" />
        <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar a projeção semanal." />
      </div>
    );
  }

  const grid = buildWeekGrid({ inputs: snap, purchases: snap.purchases });

  return (
    <div>
      <PageHeader
        eyebrow="Semanas"
        title="Projeção semanal"
        subtitle="Estoque projetado por SKU nas próximas 8 semanas — cobertura, ruptura e semana-limite de compra, por hub"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      <WeekGridView grid={grid} />
    </div>
  );
}
