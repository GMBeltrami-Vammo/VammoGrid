import { auth } from '@/auth';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { todayUtc } from '@/lib/planning/dates';
import { PageHeader, SectionTitle } from '@/components/planning/ui';
import { FrotaPanel, type FrotaRow } from '@/components/planning/FrotaPanel';
import { FleetGrowthChart, type FleetSegment } from '@/components/planning/FleetGrowthChart';

export const dynamic = 'force-dynamic';

interface LogRow {
  id: string;
  date: string;
  model: string;
  qty: number;
  note: string | null;
  created_by: string | null;
}

async function loadLog(table: string): Promise<FrotaRow[]> {
  try {
    const rows = await readFleetTable<LogRow>(table);
    return rows
      .map((r) => ({
        id: r.id,
        date: String(r.date).slice(0, 10),
        model: r.model,
        qty: Number(r.qty) || 0,
        note: r.note,
        createdBy: r.created_by,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  } catch {
    return [];
  }
}

// Frota (sub-projects E/F, request #4): the fleet-size chart (realized + estimated,
// by model, editable growth rate) plus the manual bike sales / moto order ledgers.
export default async function FrotaPage() {
  const [sales, orders, fleetRows, session] = await Promise.all([
    loadLog(FLEET_TABLES.bikeSalesLog),
    loadLog(FLEET_TABLES.bikeOrderLog),
    fetchFleetInfoRows(),
    auth(),
  ]);
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
        title="Frota — tamanho, crescimento e lançamentos"
        subtitle="Curva da frota por modelo (realizado + estimado, taxa de crescimento editável) e os lançamentos manuais de vendas e pedidos de motos."
      />
      <div className="space-y-6">
        <div>
          <SectionTitle>Tamanho da frota (por modelo)</SectionTitle>
          <FleetGrowthChart segments={segments} today={todayUtc()} isHead={isHead} />
        </div>
        <FrotaPanel log="sales" title="Vendas de motos" rows={sales} isHead={isHead} />
        <FrotaPanel log="orders" title="Pedidos de motos" rows={orders} isHead={isHead} />
      </div>
    </div>
  );
}
