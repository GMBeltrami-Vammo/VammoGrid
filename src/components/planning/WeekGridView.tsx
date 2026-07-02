'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Recycle, Flag, type LucideIcon } from 'lucide-react';
import type { HubId, WeekGridRow, WeekGridScenario } from '@/types/planning';
import type { WeekGrid } from '@/lib/planning/weekgrid';
import { SERVICE_LEVEL_LABEL, type ServiceLevelTier } from '@/lib/planning/constants';
import { fmtDate, fmtInt, weekCellClass } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/planning/InfoHint';

// Weekly stockout heatmap (sub-project C). Scope + scenario + horizon controls (the
// scenario/horizon reload the server-computed grid via the URL; scope/heat-filter/units
// are instant client views). Rows = SKUs, columns = W1..Wn end-of-week projected state.

type Scope = 'global' | HubId;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'osasco', label: 'Osasco' },
  { id: 'mooca', label: 'Mooca' },
  { id: 'sbc', label: 'SBC' },
];

const SCENARIOS: { id: WeekGridScenario; label: string }[] = [
  { id: 'baseline', label: 'Base' },
  { id: 'air_only', label: 'Só aéreo' },
  { id: 'sea_only', label: 'Só marítimo' },
  { id: 'complete', label: 'Completo' },
];

const HORIZONS = [8, 12, 16, 20];

type HeatFilter = 'all' | 'critico' | 'baixo' | 'maritimo' | 'aereo';
type Unit = 'units' | 'doh';

export function WeekGridView({
  grid,
  scenario,
  weeks,
  tier,
}: {
  grid: WeekGrid;
  scenario: WeekGridScenario;
  weeks: number;
  tier: ServiceLevelTier;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();

  const [scope, setScope] = useState<Scope>('global');
  const [search, setSearch] = useState('');
  const [heat, setHeat] = useState<HeatFilter>('all');
  const [unit, setUnit] = useState<Unit>('units');

  const go = (next: { cenario?: WeekGridScenario; sem?: number }) => {
    const params = new URLSearchParams();
    params.set('cenario', next.cenario ?? scenario);
    params.set('sem', String(next.sem ?? weeks));
    startNav(() => router.push(`${pathname}?${params.toString()}`));
  };

  const allRows = scope === 'global' ? grid.global : grid.byHub[scope];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q)) return false;
      if (heat === 'critico' && !r.cells.some((c) => c.isOut)) return false;
      if (heat === 'baixo' && !r.cells.some((c) => c.isLow)) return false;
      if (heat === 'maritimo' && r.defaultModal !== 'sea') return false;
      if (heat === 'aereo' && r.defaultModal !== 'air') return false;
      return true;
    });
  }, [allRows, search, heat]);

  const summary = useMemo(() => {
    const counts = grid.weeks.map(() => 0);
    for (const r of allRows) {
      const firstOut = r.cells.findIndex((c) => c.isOut);
      if (firstOut !== -1) counts[firstOut]++;
    }
    return counts;
  }, [allRows, grid.weeks]);

  const totalAtRisk = useMemo(() => allRows.filter((r) => r.cells.some((c) => c.isOut)).length, [allRows]);

  return (
    <div className={cn('rounded-xl bg-card p-4 ring-1 ring-foreground/10', navPending && 'opacity-60')}>
      {/* Row 1: scope + search + units */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {SCOPES.map((s) => (
            <Toggle key={s.id} active={scope === s.id} onClick={() => setScope(s.id)}>{s.label}</Toggle>
          ))}
        </div>
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-40 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        <div className="ml-auto flex gap-1">
          <Toggle active={unit === 'units'} onClick={() => setUnit('units')}>Unidades</Toggle>
          <Toggle active={unit === 'doh'} onClick={() => setUnit('doh')}>DOH</Toggle>
        </div>
      </div>

      {/* Row 2: scenario + horizon + heat filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Cobertura</span>
        {SCENARIOS.map((s) => (
          <Chip key={s.id} active={scenario === s.id} onClick={() => go({ cenario: s.id })}>{s.label}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Semanas</span>
        {HORIZONS.map((h) => (
          <Chip key={h} active={weeks === h} onClick={() => go({ sem: h })}>{h}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Filtro</span>
        {([
          ['all', 'Tudo'],
          ['critico', 'Crítico'],
          ['baixo', 'Baixo'],
          ['maritimo', 'Marítimo'],
          ['aereo', 'Aéreo'],
        ] as const).map(([id, label]) => (
          <Chip key={id} active={heat === id} onClick={() => setHeat(id)}>{label}</Chip>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} SKUs · <span className="font-medium text-alert-error">{totalAtRisk}</span> com ruptura · piso {grid.dohFloor}d ({SERVICE_LEVEL_LABEL[tier]})
        </span>
      </div>

      {/* Per-week new-stockout summary */}
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {grid.weeks.map((w, i) => (
          <div
            key={w.idx}
            className={cn(
              'rounded-lg border p-2 text-center',
              summary[i] > 0 ? 'border-alert-error/30 bg-alert-error/5' : 'border-border bg-muted/20',
            )}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Sem {w.idx}</p>
            <p className="text-[10px] text-muted-foreground">{fmtDate(w.endDate)}</p>
            <p className={cn('mt-0.5 text-lg font-bold tabular-nums', summary[i] > 0 ? 'text-alert-error' : 'text-muted-foreground/40')}>
              {summary[i]}
            </p>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 font-medium">SKU</th>
              {grid.weeks.map((w) => (
                <th key={w.idx} className="border-l border-foreground/5 px-2 py-2 text-center font-medium">
                  <span className="block">Sem {w.idx}</span>
                  <span className="block text-[10px] normal-case text-muted-foreground/70">{fmtDate(w.endDate)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={grid.weeks.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              rows.map((r) => <GridRow key={r.skuBase} row={r} unit={unit} />)
            )}
          </tbody>
        </table>
      </div>

      <Legend dohFloor={grid.dohFloor} />
    </div>
  );
}

function GridRow({ row, unit }: { row: WeekGridRow; unit: Unit }) {
  return (
    <tr className="hover:bg-muted/20">
      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 align-middle">
        <Link
          prefetch={false}
          href={`/dashboard/estoque?sku=${encodeURIComponent(row.skuBase)}`}
          className="block font-mono text-[11px] text-brand-500 hover:text-brand-400 transition-colors"
        >
          {row.skuBase}
        </Link>
        <span className="block max-w-[180px] truncate text-[11px] text-muted-foreground" title={row.skuName}>
          {row.skuName}
        </span>
      </td>
      {row.cells.map((c, i) => {
        const isBuyBy = row.buyByWeekIdx === i + 1;
        return (
          <td
            key={i}
            className={cn(
              'border-l border-foreground/5 px-2 py-1.5 text-center align-middle tabular-nums',
              weekCellClass(c),
              c.extrapolated && 'opacity-55',
            )}
            title={c.extrapolated ? 'Além do horizonte do modelo — extrapolado' : undefined}
          >
            {unit === 'units' ? (
              <>
                <span className="block text-xs font-semibold">{fmtInt(c.stock)}</span>
                <span className="block text-[10px] opacity-70">{c.doh != null ? `${c.doh}d` : '—'}</span>
              </>
            ) : (
              <>
                <span className="block text-xs font-semibold">{c.doh != null ? `${c.doh}d` : '—'}</span>
                <span className="block text-[10px] opacity-70">{fmtInt(c.stock)}</span>
              </>
            )}
            {(c.inbound > 0 || c.recovery > 0) && (
              <span className="flex items-center justify-center gap-1 text-[9px] font-medium opacity-90">
                {c.inbound > 0 && <span>{`+${fmtInt(c.inbound)}`}</span>}
                {c.recovery > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Recycle className="size-2.5" />
                    {fmtInt(c.recovery)}
                  </span>
                )}
              </span>
            )}
            {isBuyBy && (
              <span className="flex items-center justify-center gap-1 text-[9px] font-bold text-alert-warning" title="Comprar até esta semana">
                <Flag className="size-2.5" /> pedir
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Legend({ dohFloor }: { dohFloor: number }) {
  const items: { cls: string; label: string; hint: Parameters<typeof InfoHint>[0]['id']; icon?: LucideIcon }[] = [
    { cls: 'bg-alert-error/15 text-alert-error', label: 'Ruptura (estoque ≤ 0)', hint: 'week-stock' },
    { cls: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]', label: `Cobertura < ${dohFloor}d (piso)`, hint: 'week-doh' },
    { cls: 'bg-alert-success/10 text-alert-success', label: 'Chegada de pedido (+un)', hint: 'week-inbound' },
    { cls: 'bg-brand-500/10 text-brand-600', label: 'Recuperação', hint: 'recovery-line', icon: Recycle },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-3 rounded-sm', it.cls)} />
          {it.label} {it.icon && <it.icon className="size-3" />} <InfoHint id={it.hint} />
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <Flag className="size-3 text-alert-warning" /> Semana-limite de compra <InfoHint id="buy-by-week" />
      </span>
      <span className="flex items-center gap-1.5 opacity-55">
        <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/30" /> Extrapolado (além do modelo)
      </span>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:bg-muted/60',
      )}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
