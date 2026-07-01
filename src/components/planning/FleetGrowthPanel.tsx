import Link from 'next/link';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { projectFleetGrowth } from '@/lib/planning/fleetGrowth';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { SectionTitle } from '@/components/planning/ui';

// Fleet-size growth visibility (sub-project E2). Server component: reads the current
// fleet size + steady monthly growth rate from dev.fleet_info (segment 'total', edited
// in Admin) and shows the projected curve at a few milestones. Not wired into the demand
// forecast — visibility only.
export async function FleetGrowthPanel({ today }: { today: string }) {
  const rows = await fetchFleetInfoRows();
  const total = rows.find((r) => r.segment === 'total') ?? rows[0];

  if (!total) {
    return (
      <div className="mb-6">
        <SectionTitle>Frota — tamanho e crescimento</SectionTitle>
        <p className="rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Nenhum dado de frota.{' '}
          <Link href="/dashboard/admin" className="text-brand-500 hover:underline">
            Configure em Admin
          </Link>
          .
        </p>
      </div>
    );
  }

  const rate = Number(total.monthly_growth_rate) || 0;
  const curve = projectFleetGrowth({
    currentSize: Number(total.current_size) || 0,
    monthlyGrowthRate: rate,
    today,
    weeks: 26,
  });
  const at = (w: number) => curve[Math.min(w, curve.length - 1)];
  const milestones = [
    { label: 'Hoje', p: at(0) },
    { label: '+1 mês', p: at(4) },
    { label: '+3 meses', p: at(13) },
    { label: '+6 meses', p: at(26) },
  ];

  return (
    <div className="mb-6">
      <SectionTitle>Frota — tamanho e crescimento</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {milestones.map((m) => (
          <div key={m.label} className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{m.label}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{fmtInt(m.p.size)}</p>
            <p className="text-[11px] text-muted-foreground">{fmtDate(m.p.date)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Crescimento mensal <span className="font-medium text-foreground">{(rate * 100).toFixed(1)}%</span> (composto),
        a partir de {fmtInt(Number(total.current_size) || 0)} motos.{' '}
        <Link href="/dashboard/admin" className="text-brand-500 hover:underline">
          Editar
        </Link>
      </p>
    </div>
  );
}
