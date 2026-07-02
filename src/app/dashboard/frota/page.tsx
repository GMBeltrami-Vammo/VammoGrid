import { auth } from '@/auth';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { todayUtc } from '@/lib/planning/dates';
import { EmptyState, PageHeader } from '@/components/planning/ui';
import { FleetGrowthChart, type FleetSegment } from '@/components/planning/FleetGrowthChart';

export const dynamic = 'force-dynamic';

// Frota: fleet size + growth by model (realized + estimated, editable growth rate).
export default async function FrotaPage() {
  const [fleetRows, session] = await Promise.all([fetchFleetInfoRows(), auth()]);
  const isHead = session?.user?.isHead ?? false;

  const segments: FleetSegment[] = fleetRows.map((r) => ({
    segment: r.segment,
    currentSize: Number(r.current_size) || 0,
    monthlyGrowthRate: Number(r.monthly_growth_rate) || 0,
    asOfDate: r.as_of_date ?? null,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Frota"
        title="Tamanho e crescimento da frota"
        subtitle="Curva da frota por modelo — realizado + estimado, com taxa de crescimento mensal editável. Segmentos e tamanho da frota são configurados em Admin."
      />
      {segments.length === 0 ? (
        <EmptyState
          title="Sem dados de frota"
          hint="Cadastre os segmentos de frota (por modelo, com tamanho e taxa de crescimento) em Admin."
        />
      ) : (
        <FleetGrowthChart segments={segments} today={todayUtc()} isHead={isHead} />
      )}
    </div>
  );
}
