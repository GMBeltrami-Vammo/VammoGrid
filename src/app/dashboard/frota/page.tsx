import { auth } from '@/auth';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { PageHeader } from '@/components/planning/ui';
import { FrotaPanel, type FrotaRow } from '@/components/planning/FrotaPanel';

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

// Frota manual data entry (sub-project F): bike sales + moto orders entered by hand.
// Feeds the fleet-size total shown on Visão Geral (E).
export default async function FrotaPage() {
  const [sales, orders, session] = await Promise.all([
    loadLog(FLEET_TABLES.bikeSalesLog),
    loadLog(FLEET_TABLES.bikeOrderLog),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

  return (
    <div>
      <PageHeader
        eyebrow="Frota"
        title="Vendas e pedidos de motos"
        subtitle="Lançamentos manuais de vendas e pedidos de motos — alimentam o tamanho da frota. Todo lançamento é registrado."
      />
      <div className="space-y-6">
        <FrotaPanel log="sales" title="Vendas de motos" rows={sales} isHead={isHead} />
        <FrotaPanel log="orders" title="Pedidos de motos" rows={orders} isHead={isHead} />
      </div>
    </div>
  );
}
