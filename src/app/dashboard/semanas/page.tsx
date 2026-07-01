import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildWeekGrid } from '@/lib/planning/weekgrid';
import { fetchServiceLevelTier } from '@/lib/planning/source/globalSettings';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { WeekGridView } from '@/components/planning/WeekGridView';
import type { WeekGridScenario } from '@/types/planning';

export const dynamic = 'force-dynamic';

const SCENARIOS: WeekGridScenario[] = ['baseline', 'air_only', 'sea_only', 'complete'];
const HORIZONS = [8, 12, 16, 20];

// Backlog demand uplift (G2): reactivating parado bikes adds part demand roughly in
// proportion to fleet size — extra% ≈ 100 × parado / fleet. Reuses the forecast
// scaling in buildWeekGrid; no per-SKU BOM needed.
async function backlogUpliftPct(): Promise<number> {
  try {
    const [backlog, fleet] = await Promise.all([
      readFleetTable<{ status: string }>(FLEET_TABLES.backlogBikeLog),
      fetchFleetInfoRows(),
    ]);
    const parado = backlog.filter((r) => r.status === 'parado').length;
    const total = Number(fleet.find((r) => r.segment === 'total')?.current_size) || 0;
    if (parado === 0 || total <= 0) return 0;
    return Math.round((100 * parado) / total);
  } catch {
    return 0;
  }
}

export default async function SemanasPage({
  searchParams,
}: {
  searchParams: Promise<{ cenario?: string; sem?: string; backlog?: string }>;
}) {
  const sp = await searchParams;
  const scenario = (SCENARIOS.includes(sp.cenario as WeekGridScenario) ? sp.cenario : 'baseline') as WeekGridScenario;
  const weeks = HORIZONS.includes(Number(sp.sem)) ? Number(sp.sem) : 8;
  const backlogOn = sp.backlog === '1';

  const [snap, tier, backlogPct] = await Promise.all([
    safeComputeSnapshot(),
    fetchServiceLevelTier(),
    backlogOn ? backlogUpliftPct() : Promise.resolve(0),
  ]);

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
    demandScalePct: backlogPct,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Semanas"
        title="Heatmap semanal"
        subtitle="Estoque projetado por SKU e semana — cobertura, ruptura e semana-limite de compra. Simule cobertura aérea/marítima, o impacto do backlog e ajuste horizonte e piso de DOH."
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      <WeekGridView
        grid={grid}
        scenario={scenario}
        weeks={weeks}
        tier={tier}
        backlogOn={backlogOn}
        backlogPct={backlogPct}
      />
    </div>
  );
}
