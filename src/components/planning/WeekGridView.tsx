'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { SkuLink } from '@/components/planning/SkuLink';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Recycle, Flag, Ship, Plane, Truck, Package, ArrowUpRight, ChevronDown, ChevronUp, FlaskConical, Landmark, type LucideIcon } from 'lucide-react';
import type { WeekCell, WeekGridRow, WeekMeta } from '@/types/planning';
import type { WeekGrid } from '@/lib/planning/weekgrid';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import type { ModalOption } from '@/lib/planning/supplierGroups';
import { readModalCfgClient, setModalCfgEntry, writeModalCfgClient, type ModalCfg } from '@/lib/planning/modalConfig';
import { fmtDate, fmtInt, weekCellClass } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/planning/InfoHint';

// Weekly stockout heatmap (N-modal). Rows = SKUs, columns = Hoje..Wn. A supplier DROPDOWN is
// the simulation lens: its modais/leads apply to ALL shown SKUs, and per-modal CHECKBOXES pick
// which lanes feed the "com sugestão" cascade (unchecking all = baseline). Base ↔ Com-sugestão
// is an instant client swap of two server-precomputed grids; changing the supplier/modais/leads
// re-runs the server (URL + the shared vg:modalcfg cookie). Only-Global stock (no hub scopes).

const HORIZONS = [8, 12, 16, 20];

/** Rows rendered before "Mostrar mais" — keeps the grid's DOM small on big scopes. */
const INITIAL_VISIBLE_ROWS = 300;

type HeatFilter = 'all' | 'critico' | 'baixo';
type Unit = 'units' | 'doh';

interface SupplierOpt {
  supplierId: string;
  name: string;
}

function criteriaLabel(c: PurchaseCriteria): string {
  return c.mode === 'rop' ? 'critério: estoque mín + segurança' : `piso ${c.dohThreshold}d (DOH)`;
}

/** Icon + accent color for a modal, by name (marítimo/aéreo/courier/other). */
function modalVisual(name: string): { Icon: LucideIcon; className: string } {
  const n = name.toLowerCase();
  if (/mar[ií]t|sea|navio|barco/.test(n)) return { Icon: Ship, className: 'text-[color:var(--color-alert-info)]' };
  if (/a[eé]re|air|avi[ãa]o/.test(n)) return { Icon: Plane, className: 'text-brand-600' };
  if (/courier|expr|moto|terrestre|rodo/.test(n)) return { Icon: Truck, className: 'text-emerald-600 dark:text-emerald-400' };
  return { Icon: Package, className: 'text-muted-foreground' };
}

export function WeekGridView({
  grids,
  weeks,
  suggestedKey,
  suppliers = [],
  selectedSupplierId,
  modais = [],
  enabledModais = [],
  prefBySku,
  supplierNames,
}: {
  grids: Record<string, WeekGrid>;
  weeks: number;
  /** Grid key for the "com sugestão" view: combined if >1 modal, else the single modal, else baseline. */
  suggestedKey: string;
  /** Active suppliers — the simulation-lens dropdown. */
  suppliers?: SupplierOpt[];
  /** The supplier whose modais drive the simulation (applied to ALL shown SKUs). */
  selectedSupplierId: string;
  /** The selected supplier's full modais — the toggle checkboxes + per-modal config. */
  modais?: ModalOption[];
  /** Which modal names are currently enabled (checked). */
  enabledModais?: string[];
  /** skuBase → preferred supplier_id — groups the "exportar → Novo Pedido" suggestion. */
  prefBySku?: Record<string, string>;
  /** supplier_id → display name, for the export menu labels. */
  supplierNames?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();

  const [view, setView] = useState<'base' | 'sug'>('base');
  const [search, setSearch] = useState('');
  const [heat, setHeat] = useState<HeatFilter>('all');
  const [unit, setUnit] = useState<Unit>('units');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [weekFilter, setWeekFilter] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  // URL-param helper — preserves the other params (sem/forn/modais) on each change.
  const setParams = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  const goHorizon = (sem: number) => setParams({ sem: String(sem) });

  // Shared per-modal config (piso/cadência/lead) — the SAME session cookie Novo Pedido uses,
  // scoped here to the SELECTED supplier. Number edits rewrite the cookie and refresh on blur
  // (the server recomputes the grids); the modal checkboxes + supplier live in the URL.
  const [cfg, setCfg] = useState<ModalCfg>({});
  const [applyPending, startApply] = useTransition();
  useEffect(() => {
    setCfg(readModalCfgClient());
  }, []);
  const entryFor = (name: string) => cfg[selectedSupplierId]?.[name] ?? {};
  const patchEntry = (modalName: string, patch: { piso?: number | null; cad?: number | null; lead?: number | null }) => {
    const next = setModalCfgEntry(cfg, selectedSupplierId, modalName, {
      piso: patch.piso === null ? NaN : patch.piso,
      cad: patch.cad === null ? NaN : patch.cad,
      lead: patch.lead === null ? NaN : patch.lead,
    });
    setCfg(next);
    writeModalCfgClient(next);
  };
  const commitCfg = () => startApply(() => router.refresh());
  const hasCfg = Object.values(cfg[selectedSupplierId] ?? {}).some((e) => e.piso || e.cad || e.lead);
  const clearCfg = () => {
    const next = { ...cfg };
    delete next[selectedSupplierId];
    setCfg(next);
    writeModalCfgClient(next);
    startApply(() => router.refresh());
  };

  const enabledSet = useMemo(() => new Set(enabledModais), [enabledModais]);
  const toggleModal = (name: string) => {
    const next = new Set(enabledSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    const ordered = modais.filter((m) => next.has(m.name)).map((m) => m.name);
    setParams({ modais: ordered.join(',') }); // "" = none enabled → baseline
  };
  // Slowest ENABLED modal by sim lead — only it carries a cadência ("uma vez só" for the rest).
  const slowestName = useMemo(() => {
    const on = modais.filter((m) => enabledSet.has(m.name));
    if (on.length === 0) return '';
    const sorted = [...on].sort((a, b) => {
      const la = cfg[selectedSupplierId]?.[a.name]?.lead ?? a.leadDays;
      const lb = cfg[selectedSupplierId]?.[b.name]?.lead ?? b.leadDays;
      return la - lb;
    });
    return sorted[sorted.length - 1].name;
  }, [modais, enabledSet, cfg, selectedSupplierId]);

  // Base = só pedidos registrados; Com sugestão = a cascata dos modais habilitados (precomputada
  // no servidor). Trocar entre elas é instantâneo (sem ida ao servidor).
  const hasSuggestion = !!grids[suggestedKey] && suggestedKey !== 'baseline';
  const grid = (view === 'sug' ? grids[suggestedKey] : grids.baseline) ?? grids.baseline ?? Object.values(grids)[0];
  useEffect(() => {
    if (view === 'sug' && !hasSuggestion) setView('base');
  }, [view, hasSuggestion]);

  // Only the GLOBAL stock is shown (the hub/center scopes were removed per request).
  const allRows = grid.global;

  const categories = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.category).filter(Boolean))).sort() as string[],
    [allRows],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q)) return false;
      if (heat === 'critico' && !r.cells.some((c) => c.isOut)) return false;
      if (heat === 'baixo' && !r.cells.some((c) => c.isLow)) return false;
      if (catFilter !== 'all' && r.category !== catFilter) return false;
      if (weekFilter != null && r.cells.findIndex((c) => c.isOut) !== weekFilter) return false;
      return true;
    });
  }, [allRows, search, heat, catFilter, weekFilter]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS);
  }, [view, search, heat, catFilter, weekFilter]);
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

  const [exportOpen, setExportOpen] = useState(false);
  const exportGroups = useMemo(() => {
    if (!prefBySku) return { groups: [] as { supplierId: string; name: string; skus: string[] }[], noSupplier: 0 };
    const bySup = new Map<string, string[]>();
    let noSupplier = 0;
    for (const r of rows) {
      if (!r.cells.some((c) => c.isOut || c.isLow)) continue;
      const sid = prefBySku[r.skuBase];
      if (!sid) {
        noSupplier++;
        continue;
      }
      const arr = bySup.get(sid) ?? [];
      arr.push(r.skuBase);
      bySup.set(sid, arr);
    }
    const groups = [...bySup.entries()]
      .map(([supplierId, skus]) => ({ supplierId, name: supplierNames?.[supplierId] ?? supplierId, skus }))
      .sort((a, b) => b.skus.length - a.skus.length);
    return { groups, noSupplier };
  }, [rows, prefBySku, supplierNames]);

  const selectedSupplier = suppliers.find((s) => s.supplierId === selectedSupplierId) ?? null;

  return (
    <div className={cn('rounded-xl bg-card p-4 ring-1 ring-foreground/10', (navPending || applyPending) && 'opacity-60')}>
      {/* Row 1: search + export + units */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-40 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        <div className="ml-auto flex items-center gap-1">
          {prefBySku && exportGroups.groups.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  exportOpen ? 'bg-brand-500/20 text-brand-600' : 'text-brand-600 hover:bg-brand-500/10',
                )}
              >
                <ArrowUpRight className="size-3" /> Exportar → Novo Pedido
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg">
                  <p className="px-1 pb-1 text-[10px] text-muted-foreground">
                    SKUs em risco (nesta visão) por fornecedor preferido:
                  </p>
                  {exportGroups.groups.map((g) => (
                    <Link
                      key={g.supplierId}
                      href={`/dashboard/procurement?supplier=${encodeURIComponent(g.supplierId)}&skus=${encodeURIComponent(
                        g.skus.slice(0, 500).join('~'),
                      )}`}
                      onClick={() => setExportOpen(false)}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <span className="font-medium text-foreground">{g.name}</span>
                      <span className="text-muted-foreground">{g.skus.length} SKU{g.skus.length > 1 ? 's' : ''} →</span>
                    </Link>
                  ))}
                  {exportGroups.noSupplier > 0 && (
                    <p className="px-2 pt-1 text-[10px] text-muted-foreground">
                      {exportGroups.noSupplier} SKU(s) sem fornecedor preferido — vincule em Fornecedores.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <Toggle active={unit === 'units'} onClick={() => setUnit('units')}>Unidades</Toggle>
          <Toggle active={unit === 'doh'} onClick={() => setUnit('doh')}>DOH</Toggle>
        </div>
      </div>

      {/* Row 2: fornecedor (lens) + Base/Com-sugestão + horizon + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Fornecedor</span>
        {suppliers.length > 0 ? (
          <select
            value={selectedSupplierId}
            onChange={(e) => setParams({ forn: e.target.value, modais: null })}
            title="Fornecedor cujos modais alimentam a simulação (aplicado a todos os SKUs)"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
          >
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>{s.name}</option>
            ))}
          </select>
        ) : (
          <Link href="/dashboard/fornecedores" className="text-xs text-brand-600 underline">cadastre um fornecedor</Link>
        )}

        <span className="mx-1 h-4 w-px bg-border" />
        <Chip active={view === 'base'} onClick={() => setView('base')}>Base</Chip>
        <Chip active={view === 'sug'} onClick={() => hasSuggestion && setView('sug')}>
          <span className={!hasSuggestion ? 'opacity-40' : undefined}>Com sugestão</span>
        </Chip>

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
        {categories.length > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Categoria</span>
            <Chip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>Todas</Chip>
            {categories.map((c) => (
              <Chip key={c} active={catFilter === c} onClick={() => setCatFilter(c)}>{c}</Chip>
            ))}
          </>
        )}
        {weekFilter != null && (
          <Chip active onClick={() => setWeekFilter(null)}>
            {weekFilter === 0 ? 'Ruptura: hoje' : `Ruptura: sem ${weekFilter}`} ✕
          </Chip>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} SKUs · <span className="font-medium text-alert-error">{totalAtRisk}</span> com ruptura · {criteriaLabel(grid.criteria)}
        </span>
      </div>

      {/* Modais do fornecedor (simulação) — checkboxes + piso/cadência/lead; alimentam "com sugestão" */}
      {selectedSupplier && (
        <div className="mb-3 rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5 text-sm">
            <FlaskConical size={14} className="text-muted-foreground" />
            <span className="font-medium">Modais de {selectedSupplier.name} (simulação)</span>
            {hasCfg && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-600">config ativa</span>}
            <span className="text-[11px] text-muted-foreground">
              marque/desmarque para incluir no “com sugestão”; edite piso/cadência/lead (só simulação)
            </span>
            {hasCfg && (
              <button
                onClick={clearCfg}
                disabled={applyPending}
                className="ml-auto rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                Limpar config
              </button>
            )}
          </div>
          <div className="space-y-1.5 px-4 py-3">
            {modais.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Este fornecedor não tem modais cadastrados.{' '}
                <Link href="/dashboard/fornecedores" className="underline">Cadastrar modais</Link>.
              </p>
            ) : (
              modais.map((m) => {
                const { Icon, className } = modalVisual(m.name);
                const on = enabledSet.has(m.name);
                const e = entryFor(m.name);
                const isSlow = slowestName === m.name;
                const numOr = (v: string) => (v.trim() === '' ? null : Number(v));
                return (
                  <div key={m.id} className={cn('flex flex-wrap items-center gap-2 text-xs', !on && 'opacity-50')}>
                    <label className="inline-flex w-40 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleModal(m.name)}
                        className="size-3.5 cursor-pointer accent-brand-500"
                      />
                      <Icon className={cn('size-3', className)} /> {m.name}
                      <span className="text-muted-foreground">+{m.leadDays}d</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-muted-foreground">
                      lead sim.
                      <input
                        type="number"
                        min={1}
                        value={e.lead ?? ''}
                        disabled={!on}
                        onChange={(ev) => patchEntry(m.name, { lead: numOr(ev.target.value) })}
                        onBlur={commitCfg}
                        placeholder={String(m.leadDays)}
                        title="Lead hipotético (dias) — só simulação; não muda a ETA real"
                        className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1 text-muted-foreground">
                      piso
                      <input
                        type="number"
                        min={1}
                        value={e.piso ?? ''}
                        disabled={!on}
                        onChange={(ev) => patchEntry(m.name, { piso: numOr(ev.target.value) })}
                        onBlur={commitCfg}
                        placeholder={String(grid.criteria.dohThreshold)}
                        title="Piso de cobertura (DOH mín) que este modal segura"
                        className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                      />
                    </label>
                    {isSlow ? (
                      <label className="inline-flex items-center gap-1 text-muted-foreground">
                        cadência
                        <input
                          type="number"
                          min={1}
                          value={e.cad ?? ''}
                          disabled={!on}
                          onChange={(ev) => patchEntry(m.name, { cad: numOr(ev.target.value) })}
                          onBlur={commitCfg}
                          placeholder="30"
                          title="Periodicidade de reposição do modal mais lento"
                          className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                        />
                      </label>
                    ) : (
                      on && <span className="text-[10px] italic text-muted-foreground/70">uma vez só</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Per-week new-stockout summary — clickable to filter by rupture week */}
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-9">
        {grid.weeks.map((w, i) => {
          const active = weekFilter === i;
          const clickable = summary[i] > 0;
          return (
            <button
              key={w.idx}
              type="button"
              disabled={!clickable}
              onClick={() => setWeekFilter(active ? null : i)}
              className={cn(
                'rounded-lg border p-2 text-center transition-colors',
                active
                  ? 'border-alert-error bg-alert-error/10 ring-1 ring-alert-error/40'
                  : summary[i] > 0
                    ? 'border-alert-error/30 bg-alert-error/5 hover:bg-alert-error/10'
                    : 'border-border bg-muted/20',
                clickable ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{w.idx === 0 ? 'Hoje' : `Sem ${w.idx}`}</p>
              <p className="text-[10px] text-muted-foreground">{fmtDate(w.endDate)}</p>
              <p className={cn('mt-0.5 text-lg font-bold tabular-nums', summary[i] > 0 ? 'text-alert-error' : 'text-muted-foreground/40')}>
                {summary[i]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 font-medium">SKU</th>
              <th className="border-l border-foreground/5 px-2 py-2 text-right font-medium">Consumo/dia</th>
              <th className="border-l border-foreground/5 px-2 py-2 font-medium">Pedidos</th>
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
                <td colSpan={grid.weeks.length + 3} className="px-3 py-8 text-center text-muted-foreground">
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

function cellTip(row: WeekGridRow, cell: WeekCell, week: WeekMeta, criteria: PurchaseCriteria) {
  const reg = cell.arrivals.filter((a) => a.reg > 0);
  const sug = cell.arrivals.filter((a) => a.sug > 0);
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
      {reg.length > 0 && (
        <div className="mt-1 border-t border-border/60 pt-1">
          <div className="font-medium text-alert-success">✓ Pedido já colocado (chega esta semana)</div>
          <div className="flex flex-wrap gap-x-2 text-muted-foreground">
            {reg.map((a) => (
              <span key={a.modal} className={cn('inline-flex items-center gap-0.5', modalVisual(a.modal).className)}>
                {a.modal} +{fmtInt(a.reg)}
              </span>
            ))}
          </div>
          {cell.arrVos.length > 0 && (
            <div className="text-brand-600">
              {cell.arrVos.length === 1 ? `VO ${cell.arrVos[0]}` : `VOs ${cell.arrVos.join(', ')}`} · clique para abrir →
            </div>
          )}
        </div>
      )}
      {sug.length > 0 && (
        <div className="mt-1 border-t border-border/60 pt-1">
          <div className="font-medium text-[color:var(--color-alert-warning)]">
            💡 Sugestão de compra (cenário) — ainda NÃO é um pedido
          </div>
          <div className="flex flex-wrap gap-x-2 text-muted-foreground">
            {sug.map((a) => (
              <span key={a.modal} className={cn('inline-flex items-center gap-0.5', modalVisual(a.modal).className)}>
                {a.modal} +{fmtInt(a.sug)}
              </span>
            ))}
          </div>
        </div>
      )}
      {cell.recovery > 0 && (
        <div className="inline-flex items-center gap-1">
          <Recycle className="size-3" /> Recuperação: +{fmtInt(cell.recovery)} un
        </div>
      )}
      {cell.arrNat > 0 && (
        <div className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Landmark className="size-3" /> Inclui {fmtInt(cell.arrNat)} un de compra nacional
        </div>
      )}
      {row.buyByWeekIdx === week.idx && (
        <div className="font-medium text-[color:var(--color-alert-warning)]">Comprar até esta semana</div>
      )}
      {cell.extrapolated && <div className="text-muted-foreground">Extrapolado (além do modelo)</div>}
    </div>
  );
}

/** Legacy PO modal codes → display names (same rule as the engine's normalizeModal). */
function normalizeModalLabel(m: string | null): string {
  if (!m) return 'Marítimo';
  const s = m.toLowerCase();
  if (s === 'sea') return 'Marítimo';
  if (s === 'air') return 'Aéreo';
  return m;
}

// The "Pedidos" column (same as Novo Pedido): REGISTERED open POs as orange chips (modal · ETA
// · qty, linked to the pedido) and, in the "com sugestão" view, the scenario's SUGGESTED
// arrivals aggregated per modal as blue chips. Empty → em dash.
function PedidosCell({ row }: { row: WeekGridRow }) {
  const sugByModal = new Map<string, number>();
  for (const c of row.cells) for (const a of c.arrivals) if (a.sug > 0) sugByModal.set(a.modal, (sugByModal.get(a.modal) ?? 0) + a.sug);
  const sug = [...sugByModal.entries()];
  if (row.openPos.length === 0 && sug.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {row.openPos.map((p) => {
        const chip = (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 ring-1 ring-orange-500/30 dark:text-orange-400">
            <ChevronDown size={10} strokeWidth={3} />
            {normalizeModalLabel(p.modal)} · {fmtDate(p.eta)} · {fmtInt(p.qty)}
          </span>
        );
        return p.vo ? (
          <Link key={p.id} prefetch={false} href={`/dashboard/pedidos/${encodeURIComponent(p.vo)}`} className="hover:opacity-80">
            {chip}
          </Link>
        ) : (
          <span key={p.id}>{chip}</span>
        );
      })}
      {sug.map(([modal, qty]) => (
        <span
          key={modal}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 ring-1 ring-sky-500/30 dark:text-sky-400"
          title="Sugestão do cenário — ainda não é um pedido"
        >
          <ChevronUp size={10} strokeWidth={3} />
          {modal} · +{fmtInt(qty)} sug.
        </span>
      ))}
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
        <SkuLink
          skuBase={row.skuBase}
          className="block font-mono text-[11px] text-brand-500 hover:text-brand-400 transition-colors"
        >
          {row.skuBase}
        </SkuLink>
        <span className="block max-w-[180px] truncate text-[11px] text-muted-foreground" title={row.skuName}>
          {row.skuName}
        </span>
      </td>
      <td className="border-l border-foreground/5 px-2 py-1.5 text-right align-middle tabular-nums text-xs text-muted-foreground">
        <span className="block">
          {row.dailyDemand > 0 ? `${row.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/d` : '—'}
        </span>
        {row.recoveryRate > 0 && (
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-[color:var(--color-alert-info)]" title="Recuperação (refurb): taxa de retorno · dias de giro">
            <Recycle className="size-2.5" /> {Math.round(row.recoveryRate * 100)}% · {row.recoveryTurnaroundDays}d
          </span>
        )}
      </td>
      <td className="border-l border-foreground/5 px-2 py-1.5 align-middle">
        <PedidosCell row={row} />
      </td>
      {row.cells.map((c, i) => {
        const isBuyBy = row.buyByWeekIdx === weeks[i].idx;
        const clickable = c.arrVos.length > 0;
        const hasMarkers = c.arrivals.length > 0 || c.recovery > 0 || c.arrNat > 0;
        return (
          <td
            key={i}
            className={cn(
              'border-l border-foreground/5 px-2 py-1.5 text-center align-middle tabular-nums',
              weekCellClass(c),
              c.extrapolated && 'opacity-55',
              clickable ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-brand-500/50' : 'cursor-default',
            )}
            onMouseEnter={(e) => onHover(e, cellTip(row, c, weeks[i], criteria))}
            onMouseMove={(e) => onHover(e, cellTip(row, c, weeks[i], criteria))}
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
            {hasMarkers && (
              <span className="flex flex-wrap items-center justify-center gap-x-1 text-[9px] font-medium opacity-90">
                {c.arrivals.map((a) => {
                  const { Icon, className } = modalVisual(a.modal);
                  const total = a.reg + a.sug;
                  const suggestedOnly = a.reg === 0 && a.sug > 0;
                  return (
                    <span
                      key={a.modal}
                      className={cn('inline-flex items-center gap-0.5', className, suggestedOnly && 'opacity-60')}
                      title={`${a.modal}: ${a.reg > 0 ? `${fmtInt(a.reg)} pedido` : ''}${a.reg > 0 && a.sug > 0 ? ' · ' : ''}${a.sug > 0 ? `${fmtInt(a.sug)} sugerido` : ''}`}
                    >
                      <Icon className="size-2.5" />
                      {fmtInt(total)}
                    </span>
                  );
                })}
                {c.recovery > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Recycle className="size-2.5" />
                    {fmtInt(c.recovery)}
                  </span>
                )}
                {c.arrNat > 0 && (
                  <span
                    className="inline-flex items-center text-amber-600 dark:text-amber-400"
                    title={`Inclui ${fmtInt(c.arrNat)} un de compra nacional`}
                  >
                    <Landmark className="size-2.5" />
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
  const items: { cls: string; label: string; hint: Parameters<typeof InfoHint>[0]['id'] }[] = [
    { cls: 'bg-alert-error/15 text-alert-error', label: 'Ruptura (estoque ≤ 0)', hint: 'week-stock' },
    { cls: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]', label: lowLabel, hint: 'week-doh' },
    { cls: 'bg-alert-success/10 text-alert-success', label: 'Chegada de pedido', hint: 'week-inbound' },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-3 rounded-sm', it.cls)} />
          {it.label} <InfoHint id={it.hint} />
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-[color:var(--color-alert-info)]">
        <Ship className="size-3" /> Marítimo
      </span>
      <span className="flex items-center gap-1.5 text-brand-600">
        <Plane className="size-3" /> Aéreo
      </span>
      <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
        <Truck className="size-3" /> Courier / express
      </span>
      <span className="flex items-center gap-1.5 text-brand-600">
        <Recycle className="size-3" /> Recuperação <InfoHint id="recovery-line" />
      </span>
      <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
        <Landmark className="size-3" /> Chegada nacional
      </span>
      <span className="flex items-center gap-1.5">
        <Flag className="size-3 text-alert-warning" /> Semana-limite de compra <InfoHint id="buy-by-week" />
      </span>
      <span className="flex items-center gap-1.5 opacity-55">
        <span className="inline-block h-3 w-3 rounded-sm bg-muted-foreground/30" /> Extrapolado
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
