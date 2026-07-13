'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Recycle, Flag, Ship, Plane, type LucideIcon } from 'lucide-react';
import type { HubId, WeekCell, WeekGridRow, WeekGridScenario, WeekMeta } from '@/types/planning';
import type { WeekGrid } from '@/lib/planning/weekgrid';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import { fmtDate, fmtInt, weekCellClass } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/planning/InfoHint';

// Weekly stockout heatmap. All 4 scenarios are precomputed server-side; the scenario
// toggle, scope, filter and units are instant client-side views. Only the horizon
// reloads (it changes how many weeks are computed). Rows = SKUs, columns = W1..Wn.

type Scope = 'global' | HubId;
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'osasco', label: 'Osasco' },
  { id: 'mooca', label: 'Mooca' },
  { id: 'sbc', label: 'SBC' },
];

// Scenarios simulate buying WHEN NEEDED (not now). Base = registered orders only.
const SCENARIOS: { id: WeekGridScenario; label: string }[] = [
  { id: 'baseline', label: 'Base (pedidos atuais)' },
  { id: 'air_only', label: 'Aéreo qdo necessário' },
  { id: 'sea_only', label: 'Marítimo qdo necessário' },
  { id: 'complete', label: 'Combinado' },
];

const HORIZONS = [8, 12, 16, 20];

/** Rows rendered before "Mostrar mais" — keeps the grid's DOM small on big scopes. */
const INITIAL_VISIBLE_ROWS = 300;

type HeatFilter = 'all' | 'critico' | 'baixo';
type Unit = 'units' | 'doh';

// Short label for the active purchase criteria (shown in the summary + legend).
function criteriaLabel(c: PurchaseCriteria): string {
  return c.mode === 'rop' ? 'critério: estoque mín + segurança' : `piso ${c.dohThreshold}d (DOH)`;
}

export function WeekGridView({
  grids,
  weeks,
}: {
  grids: Record<WeekGridScenario, WeekGrid>;
  weeks: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();

  const [scenario, setScenario] = useState<WeekGridScenario>('baseline');
  const [scope, setScope] = useState<Scope>('global');
  const [search, setSearch] = useState('');
  const [heat, setHeat] = useState<HeatFilter>('all');
  const [unit, setUnit] = useState<Unit>('units');
  // Cursor-following hover tooltip (fixed-position so it never clips in the scroll area).
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  const grid = grids[scenario];

  const goHorizon = (sem: number) => {
    const params = new URLSearchParams();
    params.set('sem', String(sem));
    startNav(() => router.push(`${pathname}?${params.toString()}`));
  };

  const allRows = scope === 'global' ? grid.global : grid.byHub[scope];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q)) return false;
      if (heat === 'critico' && !r.cells.some((c) => c.isOut)) return false;
      if (heat === 'baixo' && !r.cells.some((c) => c.isLow)) return false;
      return true;
    });
  }, [allRows, search, heat]);

  // DOM relief: each row is weeks+2 cells, so big scopes explode the node count.
  // The per-week summary + totalAtRisk keep computing from allRows (unsliced).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS);
  }, [scenario, scope, search, heat]);
  const visibleRows = rows.length > visibleCount ? rows.slice(0, visibleCount) : rows;

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

      {/* Row 2: scenario (buy-when-needed) + horizon + heat filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Cenário</span>
        {SCENARIOS.map((s) => (
          <Chip key={s.id} active={scenario === s.id} onClick={() => setScenario(s.id)}>{s.label}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Semanas</span>
        {HORIZONS.map((h) => (
          <Chip key={h} active={weeks === h} onClick={() => goHorizon(h)}>{h}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Filtro</span>
        {([
          ['all', 'Tudo'],
          ['critico', 'Crítico'],
          ['baixo', 'Baixo'],
        ] as const).map(([id, label]) => (
          <Chip key={id} active={heat === id} onClick={() => setHeat(id)}>{label}</Chip>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} SKUs · <span className="font-medium text-alert-error">{totalAtRisk}</span> com ruptura · {criteriaLabel(grid.criteria)}
        </span>
      </div>

      {/* Per-week new-stockout summary */}
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-9">
        {grid.weeks.map((w, i) => (
          <div
            key={w.idx}
            className={cn(
              'rounded-lg border p-2 text-center',
              summary[i] > 0 ? 'border-alert-error/30 bg-alert-error/5' : 'border-border bg-muted/20',
            )}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{w.idx === 0 ? 'Hoje' : `Sem ${w.idx}`}</p>
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
              <th className="border-l border-foreground/5 px-2 py-2 text-right font-medium">Consumo/dia</th>
              {grid.weeks.map((w) => (
                <th key={w.idx} className="border-l border-foreground/5 px-2 py-2 text-center font-medium">
                  <span className="block">{w.idx === 0 ? 'Hoje' : `Sem ${w.idx}`}</span>
                  <span className="block text-[10px] normal-case text-muted-foreground/70">{fmtDate(w.endDate)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={grid.weeks.length + 2} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => (
                <GridRow
                  key={r.skuBase}
                  row={r}
                  unit={unit}
                  weeks={grid.weeks}
                  criteria={grid.criteria}
                  onHover={(e, content) => setTip({ x: e.clientX, y: e.clientY, content })}
                  onLeave={() => setTip(null)}
                  onOpenPedido={(vos) => {
                    setTip(null);
                    router.push(vos.length === 1 ? `/dashboard/pedidos/${encodeURIComponent(vos[0])}` : '/dashboard/pedidos');
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > visibleCount && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setVisibleCount((c) => c + INITIAL_VISIBLE_ROWS)}
            className="rounded-md border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
          >
            Mostrar mais ({fmtInt(rows.length - visibleCount)} restantes)
          </button>
        </div>
      )}

      <Legend criteria={grid.criteria} />

      {tip && (
        <div
          className="pointer-events-none fixed z-50 w-60 rounded-lg border border-border bg-popover px-3 py-2 text-[11px] leading-relaxed shadow-lg"
          style={{
            left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 252),
            top: tip.y + 14,
          }}
        >
          {tip.content}
        </div>
      )}
    </div>
  );
}

// The hover-detail for one cell: stock, coverage vs floor, and WHAT is happening —
// registered orders in transit vs suggested (scenario) orders, recovery income, and the
// buy-by flag. This is the "small window explaining what it is" the heatmap needed.
function cellTip(row: WeekGridRow, cell: WeekCell, week: WeekMeta, idx: number, criteria: PurchaseCriteria) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold text-foreground">
        {row.skuBase} · {week.idx === 0 ? 'Hoje' : `Sem ${week.idx}`}
      </div>
      <div className="text-muted-foreground">
        {week.idx === 0 ? 'Posição de hoje' : 'Fim da semana'}: {fmtDate(week.endDate)}
      </div>
      <div>
        Estoque: <b>{fmtInt(cell.stock)}</b> un
      </div>
      <div>
        Cobertura: <b>{cell.doh != null ? `${cell.doh}d` : '—'}</b>{' '}
        <span className="text-muted-foreground">
          ({criteria.mode === 'rop' ? 'próx. 7 dias' : `piso ${criteria.dohThreshold}d · próx. 7 dias`})
        </span>
      </div>
      <div className="text-muted-foreground">
        Consumo base: {row.dailyDemand > 0 ? `${row.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/d` : '—'}
      </div>
      {cell.isOut && <div className="font-medium text-alert-error">⚠ Ruptura projetada</div>}
      {!cell.isOut && cell.isLow && (
        <div className="font-medium text-[color:var(--color-alert-warning)]">
          {criteria.mode === 'rop' ? 'Abaixo do ponto de recompra' : 'Abaixo do piso de cobertura'}
        </div>
      )}
      {(cell.arrReg.sea > 0 || cell.arrReg.air > 0) && (
        <div className="mt-1 border-t border-border/60 pt-1">
          <div className="font-medium text-alert-success">
            ✓ Pedido já colocado (chega esta semana)
          </div>
          <div className="text-muted-foreground">
            {cell.arrReg.sea > 0 && <span>Marítimo +{fmtInt(cell.arrReg.sea)} un. </span>}
            {cell.arrReg.air > 0 && <span>Aéreo +{fmtInt(cell.arrReg.air)} un.</span>}
          </div>
          {cell.arrVos.length > 0 && (
            <div className="text-brand-600">
              {cell.arrVos.length === 1 ? `VO ${cell.arrVos[0]}` : `VOs ${cell.arrVos.join(', ')}`} · clique para abrir →
            </div>
          )}
        </div>
      )}
      {(cell.arrSug.sea > 0 || cell.arrSug.air > 0) && (
        <div className="mt-1 border-t border-border/60 pt-1">
          <div className="font-medium text-[color:var(--color-alert-warning)]">
            💡 Sugestão de compra (cenário) — ainda NÃO é um pedido
          </div>
          <div className="text-muted-foreground">
            {cell.arrSug.sea > 0 && <span>Marítimo +{fmtInt(cell.arrSug.sea)} un. </span>}
            {cell.arrSug.air > 0 && <span>Aéreo +{fmtInt(cell.arrSug.air)} un.</span>}
          </div>
        </div>
      )}
      {cell.recovery > 0 && (
        <div className="inline-flex items-center gap-1">
          <Recycle className="size-3" /> Recuperação: +{fmtInt(cell.recovery)} un
        </div>
      )}
      {row.buyByWeekIdx === week.idx && (
        <div className="font-medium text-[color:var(--color-alert-warning)]">Comprar até esta semana</div>
      )}
      {cell.extrapolated && <div className="text-muted-foreground">Extrapolado (além do modelo)</div>}
    </div>
  );
}

function GridRow({
  row,
  unit,
  weeks,
  criteria,
  onHover,
  onLeave,
  onOpenPedido,
}: {
  row: WeekGridRow;
  unit: Unit;
  weeks: WeekMeta[];
  criteria: PurchaseCriteria;
  onHover: (e: React.MouseEvent, content: React.ReactNode) => void;
  onLeave: () => void;
  onOpenPedido: (vos: string[]) => void;
}) {
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
      <td className="border-l border-foreground/5 px-2 py-1.5 text-right align-middle tabular-nums text-xs text-muted-foreground">
        {row.dailyDemand > 0 ? `${row.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/d` : '—'}
      </td>
      {row.cells.map((c, i) => {
        const isBuyBy = row.buyByWeekIdx === weeks[i].idx;
        const clickable = c.arrVos.length > 0;
        return (
          <td
            key={i}
            className={cn(
              'border-l border-foreground/5 px-2 py-1.5 text-center align-middle tabular-nums',
              weekCellClass(c),
              c.extrapolated && 'opacity-55',
              clickable ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-brand-500/50' : 'cursor-default',
            )}
            onMouseEnter={(e) => onHover(e, cellTip(row, c, weeks[i], i, criteria))}
            onMouseMove={(e) => onHover(e, cellTip(row, c, weeks[i], i, criteria))}
            onMouseLeave={onLeave}
            onClick={clickable ? () => onOpenPedido(c.arrVos) : undefined}
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
            {(c.inboundSea > 0 || c.inboundAir > 0 || c.recovery > 0) && (
              <span className="flex flex-wrap items-center justify-center gap-x-1 text-[9px] font-medium opacity-90">
                {c.inboundSea > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[color:var(--color-alert-info)]" title="Chegada marítima">
                    <Ship className="size-2.5" />
                    {fmtInt(c.inboundSea)}
                  </span>
                )}
                {c.inboundAir > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-brand-600" title="Chegada aérea">
                    <Plane className="size-2.5" />
                    {fmtInt(c.inboundAir)}
                  </span>
                )}
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

function Legend({ criteria }: { criteria: PurchaseCriteria }) {
  const lowLabel =
    criteria.mode === 'rop' ? 'Abaixo do ponto de recompra' : `Cobertura < ${criteria.dohThreshold}d (piso)`;
  const items: { cls: string; label: string; hint: Parameters<typeof InfoHint>[0]['id']; icon?: LucideIcon }[] = [
    { cls: 'bg-alert-error/15 text-alert-error', label: 'Ruptura (estoque ≤ 0)', hint: 'week-stock' },
    { cls: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]', label: lowLabel, hint: 'week-doh' },
    { cls: 'bg-alert-success/10 text-alert-success', label: 'Chegada de pedido', hint: 'week-inbound' },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-3 rounded-sm', it.cls)} />
          {it.label} {it.icon && <it.icon className="size-3" />} <InfoHint id={it.hint} />
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-[color:var(--color-alert-info)]">
        <Ship className="size-3" /> Chegada marítima <InfoHint id="week-inbound" />
      </span>
      <span className="flex items-center gap-1.5 text-brand-600">
        <Plane className="size-3" /> Chegada aérea
      </span>
      <span className="flex items-center gap-1.5 text-brand-600">
        <Recycle className="size-3" /> Recuperação (entrada de peças) <InfoHint id="recovery-line" />
      </span>
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
