'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, Link2, Plus, X } from 'lucide-react';
import type { PurchaseStatus, TransportModal } from '@/types/planning';
import type { FilterPreset, Supplier } from '@/types';
import { deletePreset, savePreset } from '@/app/dashboard/skus/presetActions';
import { BIKE_MODELS } from '@/types';
import { MODEL_LABELS } from '@/constants/models';
import { MAX_SELECTED_SKUS } from '@/lib/planning/filter';
import { writeSkusCookies } from '@/lib/planning/applyFilter';
import { createSku, setSkuScope } from '@/app/dashboard/skus/actions';
import { updateRecoveryPolicy } from '@/app/dashboard/sku/[sku]/actions';
import { linkSkusToSupplier } from '@/app/dashboard/fornecedores/actions';
import { cn } from '@/lib/utils';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { InfoHint } from '@/components/planning/InfoHint';

export interface SkuRow {
  skuBase: string;
  skuName: string;
  category: string | null;
  abcClass: string;
  onHand: number;
  /** On-hand per hub (review item 6: visão global E por hub na mesma tabela). */
  byHub: { osasco: number; mooca: number; sbc: number };
  /** Average daily consumption (un/dia) — the engine's lead-time mean. */
  dailyDemand: number;
  dohDays: number | null;
  status: PurchaseStatus;
  stockoutDate: string | null;
  isLate: boolean;
  /** Compatible bike models (cpx/comfort) — the local Modelos filter. */
  models: string[];
  /** Has a demand forecast — the local "Com previsão" filter. */
  hasForecast: boolean;
  /** National vs international sourcing — local filter + display. */
  isNational: boolean;
  isRepairable: boolean;
  /** Recovery rate (fraction 0–1) — the inline-editable Recuperação column. */
  recoveryRate: number;
  /** Recovery turnaround (days) — inline-editable. */
  recoveryTurnaroundDays: number;
  /** Preferred supplier name (null = no supplier linked). */
  supplierName: string | null;
}

// Sortable columns (review item 6). 'status' sorts by severity (CRITICAL first).
type SortKey =
  | 'skuName'
  | 'onHand'
  | 'osasco'
  | 'mooca'
  | 'sbc'
  | 'dailyDemand'
  | 'dohDays'
  | 'recovery'
  | 'status'
  | 'supplierName';
type SortDir = 'asc' | 'desc';

const STATUS_RANK: Record<PurchaseStatus, number> = { CRITICAL: 0, REORDER: 1, OK: 2 };

function sortValue(r: SkuRow, key: SortKey): number | string {
  switch (key) {
    case 'skuName': return r.skuName;
    case 'onHand': return r.onHand;
    case 'osasco': return r.byHub.osasco;
    case 'mooca': return r.byHub.mooca;
    case 'sbc': return r.byHub.sbc;
    case 'dailyDemand': return r.dailyDemand;
    // null coverage (sem demanda) sorts last regardless of direction intent → +∞.
    case 'dohDays': return r.dohDays ?? Number.POSITIVE_INFINITY;
    // Non-repairable SKUs (no recovery) sort below any repairable rate.
    case 'recovery': return r.isRepairable ? r.recoveryRate : -1;
    case 'status': return STATUS_RANK[r.status];
    case 'supplierName': return r.supplierName ?? '￿'; // no supplier sorts last
  }
}

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  CRITICAL: 'Crítico',
  REORDER: 'Recompra',
  OK: 'OK',
};

const STATUS_CLASS: Record<PurchaseStatus, string> = {
  CRITICAL: 'bg-alert-error/15 text-alert-error',
  REORDER: 'bg-alert-warning/15 text-amber-600 dark:text-alert-warning',
  OK: 'bg-alert-success/15 text-alert-success',
};

const ABC_CLASS: Record<string, string> = {
  A: 'bg-brand-500/15 text-brand-600',
  B: 'bg-brand-500/10 text-brand-500',
  C: 'text-muted-foreground',
};

/** Rows rendered before "Mostrar mais" — keeps the DOM small on the full catalog. */
const INITIAL_VISIBLE_ROWS = 300;

// App-wide category options — same set + values as the top FilterBar, so the two
// controls drive the one shared `vg:filter` cookie and stay in sync.
const CATEGORIES: { v: string | null; label: string }[] = [
  { v: null, label: 'Tudo' },
  { v: 'BIKE', label: 'Moto' },
  { v: 'BATTERY', label: 'Bateria' },
];

export function SkuTable({
  rows,
  initialSelection,
  scopeSkus,
  suppliers = [],
  presets = [],
  isHead = false,
}: {
  rows: SkuRow[];
  /** The current hand-picked selection (from the chunked cookies) — seeds the checkboxes. */
  initialSelection: string[];
  /** sku_bases in the active default universe (sub-project A). Undefined = no scope defined. */
  scopeSkus?: string[];
  /** Suppliers for the bulk "link selected SKUs to a supplier" action + the supplier filter. */
  suppliers?: Supplier[];
  /** Named selection presets — apply/save/delete. */
  presets?: FilterPreset[];
  /** Only Heads may edit the scope. */
  isHead?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [abcFilter, setAbcFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | null>(null);
  // All-local filter dimensions (nothing writes cookies anymore — the SELECTION is the
  // only thing the analyses read; these just narrow the visible list).
  const [category, setCategory] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [forecastFilter, setForecastFilter] = useState(false);
  const [natFilter, setNatFilter] = useState<'all' | 'nac' | 'int'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>(''); // supplier name; '' = todos
  const [repairFilter, setRepairFilter] = useState(false);
  const [addingSku, setAddingSku] = useState(false);
  // Column sorting: asc → desc → cleared (back to the default CRITICAL-first order).
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  // Local mirror of the active-scope set so toggles feel instant; the Server Action
  // persists to dev.fleet_sku_scope + busts the 'sku-scope' cache tag underneath.
  const hasScope = scopeSkus !== undefined;
  const [scope, setScope] = useState<Set<string>>(() => new Set(scopeSkus ?? []));
  const [scopeFilter, setScopeFilter] = useState<'all' | 'in' | 'out'>('all');
  const [scopePending, startScope] = useTransition();
  const [scopeError, setScopeError] = useState<string | null>(null);

  const toggleScope = (skuBase: string) => {
    const active = !scope.has(skuBase);
    const next = new Set(scope);
    if (active) next.add(skuBase);
    else next.delete(skuBase);
    setScope(next); // optimistic
    setScopeError(null);
    startScope(async () => {
      const res = await setSkuScope(skuBase, active);
      if (!res.ok) {
        // revert on failure
        const reverted = new Set(next);
        if (active) reverted.delete(skuBase);
        else reverted.add(skuBase);
        setScope(reverted);
        setScopeError(res.error ?? 'Erro ao salvar escopo.');
      }
    });
  };

  // Hand-picked focus set — THE recorte every other analysis reads. Lives in the
  // chunked vg:skus* cookies. This page is exempt from the narrowing (it's the
  // manager), so toggling only writes the cookies + updates local state — no server
  // refresh needed, keeping checkboxes instant.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [capHit, setCapHit] = useState(false);

  const persist = (next: Set<string>) => {
    setSelected(next);
    writeSkusCookies([...next]);
  };

  const toggle = (skuBase: string) => {
    const next = new Set(selected);
    if (next.has(skuBase)) {
      next.delete(skuBase);
    } else {
      if (next.size >= MAX_SELECTED_SKUS) {
        setCapHit(true);
        return;
      }
      next.add(skuBase);
    }
    setCapHit(false);
    persist(next);
  };

  // Every filter is LOCAL — they narrow the visible list only; "selecionar visíveis"
  // materializes the result into the selection (the app-wide recorte).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q))
        return false;
      if (category && r.category !== category) return false;
      if (abcFilter && r.abcClass !== abcFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (modelFilter && !r.models.includes(modelFilter)) return false;
      if (forecastFilter && !r.hasForecast) return false;
      if (natFilter === 'nac' && !r.isNational) return false;
      if (natFilter === 'int' && r.isNational) return false;
      if (supplierFilter === ' none' && r.supplierName != null) return false;
      if (supplierFilter && supplierFilter !== ' none' && r.supplierName !== supplierFilter) return false;
      if (repairFilter && !r.isRepairable) return false;
      if (scopeFilter === 'in' && !scope.has(r.skuBase)) return false;
      if (scopeFilter === 'out' && scope.has(r.skuBase)) return false;
      return true;
    });
    if (sort) {
      const mul = sort.dir === 'asc' ? 1 : -1;
      out.sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (typeof va === 'string' || typeof vb === 'string') {
          return mul * String(va).localeCompare(String(vb), 'pt-BR');
        }
        return mul * (va - vb);
      });
    }
    return out;
  }, [rows, search, category, abcFilter, statusFilter, modelFilter, forecastFilter, natFilter, supplierFilter, repairFilter, scopeFilter, scope, sort]);

  // DOM relief: render at most `visibleCount` rows (the full catalog can exceed 1000
  // <tr>s) with a "Mostrar mais" escape hatch. IMPORTANT: selection/bulk actions and
  // the counters keep operating on `filtered` (ALL matching rows), never the slice —
  // the in-table search/filters are the supported way to find a row (not ctrl+F).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS);
  }, [search, category, abcFilter, statusFilter, modelFilter, forecastFilter, natFilter, supplierFilter, repairFilter, scopeFilter]);
  const visibleRows = filtered.length > visibleCount ? filtered.slice(0, visibleCount) : filtered;

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.skuBase));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const r of filtered) next.delete(r.skuBase);
    } else {
      for (const r of filtered) {
        if (next.size >= MAX_SELECTED_SKUS) {
          setCapHit(true);
          break;
        }
        next.add(r.skuBase);
      }
    }
    persist(next);
  };

  const clearSelection = () => {
    setCapHit(false);
    persist(new Set());
  };

  // Named presets: apply loads the saved list into the selection; save snapshots the
  // current selection under a name (Head). Applying is instant/local (persist writes
  // the cookies); other pages read it on their next render.
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetPending, startPreset] = useTransition();
  const [presetMsg, setPresetMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.presetId === id);
    if (!p) return;
    setCapHit(false);
    persist(new Set(p.skus.slice(0, MAX_SELECTED_SKUS)));
    setPresetMsg({ tone: 'ok', text: `Preset “${p.name}” aplicado (${p.skus.length} SKUs).` });
  };

  const saveCurrentAsPreset = () => {
    if (!presetName.trim() || selected.size === 0) return;
    setPresetMsg(null);
    startPreset(async () => {
      const res = await savePreset(presetName, [...selected]);
      if (res.ok) {
        setPresetName('');
        setPresetMsg({ tone: 'ok', text: 'Preset salvo.' });
        router.refresh();
      } else {
        setPresetMsg({ tone: 'err', text: res.error ?? 'Erro ao salvar preset.' });
      }
    });
  };

  const removePreset = () => {
    if (!presetId) return;
    const p = presets.find((x) => x.presetId === presetId);
    if (!p || !window.confirm(`Excluir o preset “${p.name}”?`)) return;
    startPreset(async () => {
      const res = await deletePreset(presetId);
      if (res.ok) {
        setPresetId('');
        setPresetMsg({ tone: 'ok', text: 'Preset excluído.' });
        router.refresh();
      } else {
        setPresetMsg({ tone: 'err', text: res.error ?? 'Erro ao excluir.' });
      }
    });
  };

  // Bulk-link the current selection to one supplier (from the selection banner).
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active), [suppliers]);
  const [bulkSupplierId, setBulkSupplierId] = useState('');
  const [bulkPreferred, setBulkPreferred] = useState(false);
  const [bulkPending, startBulk] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const bulkLink = () => {
    if (!bulkSupplierId || selected.size === 0) return;
    setBulkMsg(null);
    const skus = [...selected];
    startBulk(async () => {
      const res = await linkSkusToSupplier(skus, bulkSupplierId, { makePreferred: bulkPreferred });
      if (res.ok) {
        const name = suppliers.find((s) => s.supplierId === bulkSupplierId)?.name ?? 'fornecedor';
        setBulkMsg({ tone: 'ok', text: `${res.linked ?? skus.length} SKU(s) vinculados a ${name}.` });
        router.refresh();
      } else {
        setBulkMsg({ tone: 'err', text: res.error ?? 'Erro ao vincular.' });
      }
    });
  };

  const localActive =
    abcFilter || statusFilter || search || category || modelFilter || forecastFilter ||
    natFilter !== 'all' || supplierFilter || repairFilter;
  const clearAll = () => {
    setAbcFilter(null);
    setStatusFilter(null);
    setSearch('');
    setCategory(null);
    setModelFilter(null);
    setForecastFilter(false);
    setNatFilter('all');
    setSupplierFilter('');
    setRepairFilter(false);
  };

  // "Relatório semanal de estoque" (review item 1/6): the FULL filtered set (not the
  // rendered slice), with every column, as CSV.
  const exportCsv = () => {
    const header = [
      'sku', 'nome', 'categoria', 'classe', 'status', 'estoque_total',
      'osasco', 'mooca', 'sbc', 'consumo_dia', 'cobertura_dias', 'ruptura',
      'recuperavel', 'taxa_recuperacao_pct', 'turnaround_dias',
      'fornecedor', 'origem', 'em_escopo', 'selecionado',
    ];
    const lines = filtered.map((r) =>
      [
        r.skuBase,
        `"${r.skuName.replace(/"/g, '""')}"`,
        r.category ?? '',
        r.abcClass,
        r.status,
        r.onHand,
        r.byHub.osasco,
        r.byHub.mooca,
        r.byHub.sbc,
        r.dailyDemand.toFixed(2),
        r.dohDays ?? '',
        r.stockoutDate ?? '',
        r.isRepairable ? 'sim' : 'nao',
        r.isRepairable ? Math.round(r.recoveryRate * 100) : '',
        r.isRepairable ? r.recoveryTurnaroundDays : '',
        r.supplierName ? `"${r.supplierName.replace(/"/g, '""')}"` : '',
        r.isNational ? 'nacional' : 'internacional',
        scope.has(r.skuBase) ? 'sim' : 'nao',
        selected.has(r.skuBase) ? 'sim' : 'nao',
      ].join(','),
    );
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estoque-skus-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Add SKU */}
      {isHead && (
        <div className="mb-3 flex justify-end">
          {!addingSku && (
            <button
              onClick={() => setAddingSku(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-400"
            >
              <Plus size={15} /> Adicionar SKU
            </button>
          )}
        </div>
      )}
      {isHead && addingSku && (
        <AddSkuForm
          onDone={() => {
            setAddingSku(false);
            router.refresh();
          }}
          onCancel={() => setAddingSku(false)}
        />
      )}

      {/* Filters — ALL local: they narrow the visible list; "selecionar visíveis"
          materializes the result into the app-wide selection. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />

        <Chip label="Categoria" />
        {CATEGORIES.map((c) => (
          <FilterChip key={c.label} active={category === c.v} onClick={() => setCategory(c.v)}>
            {c.label}
          </FilterChip>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />
        <Chip label="Modelo" />
        <FilterChip active={modelFilter === null} onClick={() => setModelFilter(null)}>Todos</FilterChip>
        {BIKE_MODELS.map((m) => (
          <FilterChip key={m} active={modelFilter === m} onClick={() => setModelFilter(modelFilter === m ? null : m)}>
            {MODEL_LABELS[m] ?? m.toUpperCase()}
          </FilterChip>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />
        {['A', 'B', 'C'].map((cls) => (
          <FilterChip key={cls} active={abcFilter === cls} onClick={() => setAbcFilter(abcFilter === cls ? null : cls)}>
            Classe {cls}
          </FilterChip>
        ))}

        {(['CRITICAL', 'REORDER', 'OK'] as PurchaseStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              statusFilter === s ? STATUS_CLASS[s] : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={forecastFilter} onClick={() => setForecastFilter((v) => !v)}>
          Com previsão
        </FilterChip>

        <span className="mx-1 h-4 w-px bg-border" />
        <Chip label="Origem" />
        {([
          ['all', 'Tudo'],
          ['nac', 'Nacional'],
          ['int', 'Internacional'],
        ] as const).map(([v, label]) => (
          <FilterChip key={v} active={natFilter === v} onClick={() => setNatFilter(v)}>
            {label}
          </FilterChip>
        ))}

        <FilterChip active={repairFilter} onClick={() => setRepairFilter((v) => !v)}>
          Recuperável
        </FilterChip>

        <span className="mx-1 h-4 w-px bg-border" />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="h-7 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
          title="Filtrar por fornecedor preferido"
        >
          <option value="">Fornecedor: todos</option>
          {activeSuppliers.map((s) => (
            <option key={s.supplierId} value={s.name}>
              {s.name}
            </option>
          ))}
          <option value=" none">— sem fornecedor —</option>
        </select>

        {localActive && (
          <button
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Limpar filtros
          </button>
        )}

        {hasScope && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <Chip label="Escopo" />
            {([
              ['all', 'Tudo'],
              ['in', 'Em escopo'],
              ['out', 'Fora'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setScopeFilter(v)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  scopeFilter === v
                    ? 'bg-alert-success/20 text-alert-success'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </>
        )}

        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
          title="Exportar o conjunto filtrado completo (relatório de estoque)"
        >
          <Download size={13} /> Exportar CSV
        </button>

        <span className="ml-auto text-[11px] text-muted-foreground">
          {hasScope && <span className="mr-2">{scope.size} em escopo</span>}
          {filtered.length} / {rows.length} SKUs
        </span>
      </div>

      {scopeError && (
        <p className="mb-3 rounded-lg bg-alert-error/10 px-3 py-1.5 text-xs text-alert-error ring-1 ring-alert-error/30">
          {scopeError}
        </p>
      )}

      {/* Presets nomeados — aplicar/salvar/excluir a seleção como custom filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <Chip label="Presets" />
        <select
          value={presetId}
          onChange={(e) => applyPreset(e.target.value)}
          className="h-7 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
        >
          <option value="">Aplicar preset…</option>
          {presets.map((p) => (
            <option key={p.presetId} value={p.presetId}>
              {p.name} ({p.skus.length})
            </option>
          ))}
        </select>
        {isHead && presetId && (
          <button onClick={removePreset} disabled={presetPending} className="text-muted-foreground hover:text-alert-error" title="Excluir preset">
            <X size={13} />
          </button>
        )}
        {isHead && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Salvar seleção como…"
              className="h-7 w-44 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
            />
            <button
              onClick={saveCurrentAsPreset}
              disabled={presetPending || !presetName.trim() || selected.size === 0}
              className="rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-400 disabled:opacity-40"
            >
              {presetPending ? 'Salvando…' : `Salvar (${selected.size})`}
            </button>
          </>
        )}
        {presetMsg && (
          <span className={presetMsg.tone === 'ok' ? 'text-alert-success' : 'text-alert-error'}>{presetMsg.text}</span>
        )}
      </div>

      {/* Selection summary — the hand-picked set that focuses every other analysis */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-500/10 px-3 py-2 text-xs ring-1 ring-brand-500/20">
          <Check size={14} className="text-brand-600" />
          <span className="font-medium text-brand-600">
            {selected.size} SKU{selected.size > 1 ? 's' : ''} selecionado{selected.size > 1 ? 's' : ''} — análises focadas neste conjunto
          </span>
          <span className="text-muted-foreground">
            (Estoque, Semanas, Compras, Transferências, Alertas)
          </span>
          <button
            onClick={clearSelection}
            className="ml-auto rounded px-2 py-0.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Limpar seleção
          </button>

          {/* Bulk-link the selection to a supplier */}
          {isHead && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-brand-500/20 pt-2">
              <Link2 size={13} className="text-brand-600" />
              <span className="font-medium text-foreground">Vincular seleção a fornecedor:</span>
              {activeSuppliers.length === 0 ? (
                <Link
                  href="/dashboard/fornecedores"
                  className="text-brand-600 underline hover:text-brand-500"
                >
                  cadastre um fornecedor primeiro
                </Link>
              ) : (
                <>
                  <select
                    value={bulkSupplierId}
                    onChange={(e) => setBulkSupplierId(e.target.value)}
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500"
                  >
                    <option value="">Escolher fornecedor…</option>
                    {activeSuppliers.map((s) => (
                      <option key={s.supplierId} value={s.supplierId}>
                        {s.name} ({s.kind === 'nacional' ? 'Nac' : 'Intl'})
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={bulkPreferred}
                      onChange={(e) => setBulkPreferred(e.target.checked)}
                      className="size-3.5 cursor-pointer accent-brand-500"
                    />
                    marcar como preferido
                  </label>
                  <button
                    onClick={bulkLink}
                    disabled={!bulkSupplierId || bulkPending}
                    className="rounded-md bg-brand-500 px-2.5 py-1 font-medium text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {bulkPending ? 'Vinculando…' : `Vincular ${selected.size}`}
                  </button>
                  {bulkMsg && (
                    <span className={bulkMsg.tone === 'ok' ? 'text-alert-success' : 'text-alert-error'}>
                      {bulkMsg.text}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {capHit && (
        <p className="mb-3 rounded-lg bg-alert-warning/10 px-3 py-1.5 text-xs text-[color:var(--color-alert-warning)] ring-1 ring-alert-warning/30">
          Limite de {MAX_SELECTED_SKUS} SKUs selecionados. Use os filtros de categoria/classe para conjuntos maiores.
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos visíveis"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  className="size-3.5 cursor-pointer accent-brand-500 align-middle"
                />
              </th>
              <th className="px-3 py-2.5 font-medium">SKU</th>
              {hasScope && <th className="px-3 py-2.5 font-medium">Escopo</th>}
              <th className="px-3 py-2.5 font-medium">
                <SortHeader label="Nome" k="skuName" sort={sort} onSort={toggleSort} />
              </th>
              <th className="px-3 py-2.5 font-medium">Categ.</th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Classe <InfoHint id="abc-class" /></span>
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                <SortHeader label="Estoque" k="onHand" sort={sort} onSort={toggleSort} hint={<InfoHint id="onhand" />} />
              </th>
              <th className="px-2 py-2.5 text-right font-medium">
                <SortHeader label="OSA" k="osasco" sort={sort} onSort={toggleSort} />
              </th>
              <th className="px-2 py-2.5 text-right font-medium">
                <SortHeader label="MOO" k="mooca" sort={sort} onSort={toggleSort} />
              </th>
              <th className="px-2 py-2.5 text-right font-medium">
                <SortHeader label="SBC" k="sbc" sort={sort} onSort={toggleSort} />
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                <SortHeader label="Consumo/dia" k="dailyDemand" sort={sort} onSort={toggleSort} hint={<InfoHint id="daily-demand" />} />
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                <SortHeader label="Cobertura" k="dohDays" sort={sort} onSort={toggleSort} hint={<InfoHint id="sku-doh" />} />
              </th>
              <th className="px-3 py-2.5 font-medium">
                <SortHeader label="Recuperação" k="recovery" sort={sort} onSort={toggleSort} hint={<InfoHint id="recovery-rate" />} />
              </th>
              <th className="px-3 py-2.5 font-medium">
                <SortHeader label="Fornecedor" k="supplierName" sort={sort} onSort={toggleSort} />
              </th>
              <th className="px-3 py-2.5 font-medium">
                <SortHeader label="Status" k="status" sort={sort} onSort={toggleSort} hint={<InfoHint id="purchase-status" />} />
              </th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Ruptura <InfoHint id="stockout-date" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={hasScope ? 16 : 15} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum SKU encontrado.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => {
                const isSel = selected.has(r.skuBase);
                return (
                  <tr
                    key={r.skuBase}
                    className={cn('transition-colors', isSel ? 'bg-brand-500/5' : 'hover:bg-muted/30')}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${r.skuBase}`}
                        checked={isSel}
                        onChange={() => toggle(r.skuBase)}
                        className="size-3.5 cursor-pointer accent-brand-500 align-middle"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(r.skuBase)}`}
                        className="font-mono text-xs text-brand-500 hover:text-brand-400 transition-colors"
                      >
                        {r.skuBase}
                      </Link>
                    </td>
                    {hasScope && (
                      <td className="px-3 py-2">
                        {isHead ? (
                          <button
                            onClick={() => toggleScope(r.skuBase)}
                            disabled={scopePending}
                            aria-pressed={scope.has(r.skuBase)}
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50',
                              scope.has(r.skuBase)
                                ? 'bg-alert-success/15 text-alert-success hover:bg-alert-success/25'
                                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                            )}
                            title={scope.has(r.skuBase) ? 'Remover do escopo padrão' : 'Adicionar ao escopo padrão'}
                          >
                            {scope.has(r.skuBase) ? 'Em escopo' : 'Fora'}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-medium',
                              scope.has(r.skuBase)
                                ? 'bg-alert-success/15 text-alert-success'
                                : 'text-muted-foreground',
                            )}
                          >
                            {scope.has(r.skuBase) ? 'Em escopo' : 'Fora'}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 max-w-[200px]">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(r.skuBase)}`}
                        className="truncate block text-foreground hover:text-brand-500 transition-colors"
                      >
                        {r.skuName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.category ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          ABC_CLASS[r.abcClass] ?? 'text-muted-foreground',
                        )}
                      >
                        {r.abcClass}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.onHand)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">{fmtInt(r.byHub.osasco)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">{fmtInt(r.byHub.mooca)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">{fmtInt(r.byHub.sbc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {r.dailyDemand > 0 ? r.dailyDemand.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.dohDays != null ? `${fmtInt(r.dohDays)}d` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <RecoveryCell row={r} editable={isHead} />
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs text-muted-foreground" title={r.supplierName ?? undefined}>
                      {r.supplierName ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          STATUS_CLASS[r.status],
                        )}
                      >
                        {STATUS_LABEL[r.status]}
                        {r.isLate && ' ⚠'}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      {r.stockoutDate ? (
                        <span className="text-alert-error">{fmtDate(r.stockoutDate)}</span>
                      ) : (
                        <span className="text-alert-success">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > visibleCount && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setVisibleCount((c) => c + INITIAL_VISIBLE_ROWS)}
            className="rounded-md border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
          >
            Mostrar mais ({fmtInt(filtered.length - visibleCount)} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50';

// Register a brand-new SKU: its planning attributes (lead times, national/international,
// default modal, ABC) + display name. Writes a policy + scope row via createSku, then
// the page refreshes and the SKU appears (zero stock until inventory for it lands).
function AddSkuForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [skuBase, setSkuBase] = useState('');
  const [skuName, setSkuName] = useState('');
  const [sea, setSea] = useState('110');
  const [air, setAir] = useState('30');
  const [isNational, setIsNational] = useState(false);
  const [defaultModal, setDefaultModal] = useState<TransportModal>('sea');
  const [abc, setAbc] = useState('C');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    if (!skuBase.trim()) {
      setErr('Código do SKU é obrigatório.');
      return;
    }
    start(async () => {
      const res = await createSku({
        skuBase,
        skuName,
        leadTimeSeaDays: sea === '' ? null : Number(sea),
        leadTimeAirDays: air === '' ? null : Number(air),
        isNational,
        defaultModal,
        abcClass: abc || null,
      });
      if (res.ok) onDone();
      else setErr(res.error ?? 'Erro ao adicionar SKU.');
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-500">Novo SKU</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Labeled label="Código do SKU *">
          <input value={skuBase} onChange={(e) => setSkuBase(e.target.value)} placeholder="VM-01-FRE0-1010" className={cn(INPUT_CLASS, 'font-mono text-xs')} />
        </Labeled>
        <Labeled label="Nome">
          <input value={skuName} onChange={(e) => setSkuName(e.target.value)} placeholder="Pastilha de freio…" className={INPUT_CLASS} />
        </Labeled>
        <Labeled label="Lead marítimo (dias)">
          <input type="number" min={0} value={sea} onChange={(e) => setSea(e.target.value)} className={cn(INPUT_CLASS, 'text-right tabular-nums')} />
        </Labeled>
        <Labeled label="Lead aéreo (dias)">
          <input type="number" min={0} value={air} onChange={(e) => setAir(e.target.value)} className={cn(INPUT_CLASS, 'text-right tabular-nums')} />
        </Labeled>
        <Labeled label="Origem">
          <select value={isNational ? 'nac' : 'int'} onChange={(e) => setIsNational(e.target.value === 'nac')} className={INPUT_CLASS}>
            <option value="int">Internacional</option>
            <option value="nac">Nacional</option>
          </select>
        </Labeled>
        <Labeled label="Modal padrão">
          <select value={defaultModal} onChange={(e) => setDefaultModal(e.target.value as TransportModal)} className={INPUT_CLASS}>
            <option value="sea">Marítimo</option>
            <option value="air">Aéreo</option>
          </select>
        </Labeled>
        <Labeled label="Classe ABC">
          <select value={abc} onChange={(e) => setAbc(e.target.value)} className={INPUT_CLASS}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </Labeled>
      </div>
      {err && <p className="mt-3 rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
        >
          <Check size={15} /> {pending ? 'Adicionando…' : 'Adicionar SKU'}
        </button>
        <button
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40"
        >
          <X size={15} /> Cancelar
        </button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

// Inline recovery editor (Head only): repairable toggle + rate (%) + turnaround (days), saved
// per row via updateRecoveryPolicy — no need to open the SKU page. Local state is the source of
// truth after an edit (no page refresh). Number inputs commit on blur, the toggle on click; a
// `saved` ref suppresses no-op writes so the audit log isn't spammed on a plain focus→blur.
function RecoveryCell({ row, editable }: { row: SkuRow; editable: boolean }) {
  const [repairable, setRepairable] = useState(row.isRepairable);
  const [rate, setRate] = useState(Math.round(row.recoveryRate * 100));
  const [turn, setTurn] = useState(row.recoveryTurnaroundDays);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [, start] = useTransition();
  const saved = useRef({
    repairable: row.isRepairable,
    rate: Math.round(row.recoveryRate * 100),
    turn: row.recoveryTurnaroundDays,
  });

  const commit = (next: { repairable?: boolean; rate?: number; turn?: number }) => {
    const p = next.repairable ?? repairable;
    const rt = clampNum(next.rate ?? rate, 0, 100);
    const tn = clampNum(next.turn ?? turn, 1, 365);
    if (p === saved.current.repairable && rt === saved.current.rate && tn === saved.current.turn) return;
    setStatus('saving');
    start(async () => {
      const res = await updateRecoveryPolicy(row.skuBase, {
        recoveryRate: rt / 100,
        recoveryTurnaroundDays: tn,
        isRepairable: p,
      });
      if (res.ok) {
        saved.current = { repairable: p, rate: rt, turn: tn };
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1500);
      } else {
        setStatus('error');
      }
    });
  };

  if (!editable) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {repairable ? `${rate}% · ${turn}d` : '—'}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        role="switch"
        aria-checked={repairable}
        aria-label={`Recuperável ${row.skuBase}`}
        title={repairable ? 'Recuperável — clique para desativar' : 'Não recuperável — clique para ativar'}
        onClick={() => {
          const v = !repairable;
          setRepairable(v);
          commit({ repairable: v });
        }}
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          repairable ? 'bg-brand-500' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
            repairable ? 'left-3.5' : 'left-0.5',
          )}
        />
      </button>
      <input
        type="number"
        min={0}
        max={100}
        value={rate}
        disabled={!repairable}
        aria-label={`Taxa de recuperação ${row.skuBase} (%)`}
        onChange={(e) => setRate(clampNum(Number(e.target.value), 0, 100))}
        onBlur={() => commit({})}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-7 w-11 rounded border border-border bg-background px-1 text-right text-xs tabular-nums outline-none focus:border-brand-500 disabled:opacity-40"
      />
      <span className="text-[10px] text-muted-foreground">%</span>
      <input
        type="number"
        min={1}
        max={365}
        value={turn}
        disabled={!repairable}
        aria-label={`Turnaround ${row.skuBase} (dias)`}
        onChange={(e) => setTurn(clampNum(Number(e.target.value), 1, 365))}
        onBlur={() => commit({})}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-7 w-10 rounded border border-border bg-background px-1 text-right text-xs tabular-nums outline-none focus:border-brand-500 disabled:opacity-40"
      />
      <span className="text-[10px] text-muted-foreground">d</span>
      <span className="w-3 text-center text-[11px] leading-none">
        {status === 'saving' ? (
          <span className="text-muted-foreground">…</span>
        ) : status === 'saved' ? (
          <span className="text-alert-success">✓</span>
        ) : status === 'error' ? (
          <span className="text-alert-error" title="Erro ao salvar">✗</span>
        ) : null}
      </span>
    </div>
  );
}

/** Tiny uppercase label between chip groups. */
function Chip({ label }: { label: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{label}</span>
  );
}

/** Toggleable filter chip (brand tint when active). */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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

/** Clickable column header: asc → desc → cleared. */
function SortHeader({
  label,
  k,
  sort,
  onSort,
  hint,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (k: SortKey) => void;
  hint?: React.ReactNode;
}) {
  const active = sort?.key === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={cn(
        'inline-flex items-center gap-1 font-medium uppercase tracking-wide transition-colors hover:text-foreground',
        active ? 'text-brand-600' : undefined,
      )}
      title="Ordenar"
    >
      {label}
      {hint}
      <span className="w-2 text-[9px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
    </button>
  );
}
