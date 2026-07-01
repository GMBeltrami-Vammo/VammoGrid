import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildWeekGrid } from '@/lib/planning/weekgrid';
import { fetchServiceLevelTier } from '@/lib/planning/source/globalSettings';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { WeekGridView } from '@/components/planning/WeekGridView';
import type { WeekGridScenario } from '@/types/planning';

export const dynamic = 'force-dynamic';

const SCENARIOS: WeekGridScenario[] = ['baseline', 'air_only', 'sea_only', 'complete'];
const HORIZONS = [8, 12, 16, 20];

export default async function SemanasPage({
  searchParams,
}: {
  searchParams: Promise<{ cenario?: string; sem?: string }>;
}) {
  const sp = await searchParams;
  const scenario = (SCENARIOS.includes(sp.cenario as WeekGridScenario) ? sp.cenario : 'baseline') as WeekGridScenario;
  const weeks = HORIZONS.includes(Number(sp.sem)) ? Number(sp.sem) : 8;

  const [snap, tier] = await Promise.all([safeComputeSnapshot(), fetchServiceLevelTier()]);

  if (snap.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Semanas" title="Heatmap semanal" />
        <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar o heatmap semanal." />
      </div>
    );
  }

  const grid = buildWeekGrid({
    inputs: snap,
    purchases: snap.purchases,
    weeks,
    scenario,
    serviceLevelTier: tier,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Semanas"
        title="Heatmap semanal"
        subtitle="Estoque projetado por SKU e semana — cobertura, ruptura e semana-limite de compra. Simule a cobertura de pedidos aéreo/marítimo e ajuste horizonte e piso de DOH."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      <WeekGridView grid={grid} scenario={scenario} weeks={weeks} tier={tier} />
    </div>
  );
}
