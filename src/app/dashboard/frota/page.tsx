import { auth } from '@/auth';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { fetchFleetWeeklySizes } from '@/lib/planning/source/fleetSizeWeekly';
import { todayUtc } from '@/lib/planning/dates';
import { EmptyState, PageHeader } from '@/components/planning/ui';
import { FleetGrowthChart, type FleetSegment, type FleetWeeklyActual } from '@/components/planning/FleetGrowthChart';
import { FleetWeeklyPanel } from '@/components/planning/FleetWeeklyPanel';

export const dynamic = 'force-dynamic';

// Frota: fleet size + growth by model — realized (weekly REAL records) + estimated
// (linear projection anchored on the latest record), editable growth rate.
export default async function FrotaPage() {
  const [fleetRows, weeklyRows, session] = await Promise.all([
    fetchFleetInfoRows(),
    fetchFleetWeeklySizes(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;
  const today = todayUtc();

  const segments: FleetSegment[] = fleetRows.map((r) => ({
    segment: r.segment,
    currentSize: Number(r.current_size) || 0,
    monthlyGrowthRate: Number(r.monthly_growth_rate) || 0,
    asOfDate: r.as_of_date ?? null,
  }));
  const actuals: FleetWeeklyActual[] = weeklyRows.map((r) => ({
    segment: r.segment,
    weekStart: r.week_start,
    size: r.size,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Frota"
        title="Tamanho e crescimento da frota"
        subtitle="Curva da frota por modelo — realizado (registros semanais) + estimado, com taxa de crescimento mensal editável. Segmentos são configurados em Admin."
      />
      {segments.length === 0 ? (
        <EmptyState
          title="Sem dados de frota"
          hint="Cadastre os segmentos de frota (por modelo, com tamanho e taxa de crescimento) em Admin."
        />
      ) : (
        <>
          <FleetGrowthChart segments={segments} actuals={actuals} today={today} isHead={isHead} />
          <FleetWeeklyPanel
            segments={segments.map((s) => s.segment)}
            rows={actuals}
            isHead={isHead}
            today={today}
          />
        </>
      )}
    </div>
  );
}
