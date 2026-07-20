'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Download, Filter, Link2, ListChecks, Plus, X } from 'lucide-react';
import type { PurchaseStatus, TransportModal } from '@/types/planning';
import type { FilterPreset, Supplier } from '@/types';
import { deletePreset, savePreset } from '@/app/dashboard/skus/presetActions';
import { MAX_SELECTED_SKUS } from '@/lib/planning/filter';
import { writeSkusCookies } from '@/lib/planning/applyFilter';
import { createSku } from '@/app/dashboard/skus/actions';
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
  /** On-hand per hub (visão global E por hub na mesma tabela). */
  byHub: { osasco: number; mooca: number; sbc: number };
  /** Average daily consumption (un/dia) — the engine's lead-time mean. */
  dailyDemand: number;
  dohDays: number | null;
  status: PurchaseStatus;
  stockoutDate: string | null;
  isLate: boolean;
  /** Compatible bike models (cpx/comfort). */
  models: string[];
  /** Has a demand forecast. */
  hasForecast: boolean;
  /** National vs international sourcing. */
  isNational: boolean;
  isRepairable: boolean;
  /** Recovery rate (fraction 0–1) — the inline-editable Recuperação column. */
  recoveryRate: number;
  /** Recovery turnaround (days) — inline-editable. */
  recoveryTurnaroundDays: number;
  /** Preferred supplier name (null = no supplier linked). */
  supplierName: string | null;
}

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  CRITICAL: 'Crítico',
  REORDER: 'Recompra',
  OK: 'OK',
};

const STATUS_RANK: Record<PurchaseStatus, number> = { CRITICAL: 0, REORDER: 1, OK: 2 };

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

// ── Column model: each column carries its spreadsheet-style autofilter (sort + type-aware
// filter). The row CELLS are still bespoke (SKU link, hub numbers, recovery editor, badges);
// this config drives only the header filters + the filtering/sorting math. ────────────────
type ColType = 'text' | 'enum' | 'num';
interface ColDef {
  key: string;
  label: string;
  type: ColType;
  /** Value used for filtering (and sorting, unless sortGet overrides). */
  get: (r: SkuRow) => string | number;
  /** Value used for sorting when it must differ from the filter value (e.g. status severity). */
  sortGet?: (r: SkuRow) => string | number;
}

const COLUMNS: ColDef[] = [
  { key: 'skuBase', label: 'SKU', type: 'text', get: (r) => r.skuBase },
  { key: 'skuName', label: 'Nome', type: 'text', get: (r) => r.skuName },
  { key: 'abcClass', label: 'Classe', type: 'enum', get: (r) => r.abcClass },
  { key: 'onHand', label: 'Estoque', type: 'num', get: (r) => r.onHand },
  { key: 'osasco', label: 'OSA', type: 'num', get: (r) => r.byHub.osasco },
  { key: 'mooca', label: 'MOO', type: 'num', get: (r) => r.byHub.mooca },
  { key: 'sbc', label: 'SBC', type: 'num', get: (r) => r.byHub.sbc },
  { key: 'dailyDemand', label: 'Consumo/dia', type: 'num', get: (r) => r.dailyDemand },
  { key: 'recovery', label: 'Recuperação', type: 'enum', get: (r) => (r.isRepairable ? 'Sim' : 'Não') },
  { key: 'supplierName', label: 'Fornecedor', type: 'enum', get: (r) => r.supplierName ?? '— sem —' },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    get: (r) => STATUS_LABEL[r.status],
    sortGet: (r) => STATUS_RANK[r.status],
  },
  {
    key: 'ruptura',
    label: 'Ruptura',
    type: 'enum',
    get: (r) => (r.stockoutDate ? 'Com ruptura' : 'Sem ruptura'),
    sortGet: (r) => r.stockoutDate ?? '￿',
  },
];

interface ColFilter {
  /** text: substring match. */
  search?: string;
  /** enum: the ALLOWED values (undefined = all allowed). */
  checked?: string[];
  /** num: inclusive bounds. */
  min?: number | null;
  max?: number | null;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

function filterActive(col: ColDef, f: ColFilter | undefined): boolean {
  if (!f) return false;
  if (col.type === 'text') return !!f.search;
  if (col.type === 'enum') return f.checked != null;
  return f.min != null || f.max != null;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function SkuTable({
  rows,
  initialSelection,
  suppliers = [],
  presets = [],
  isHead = false,
}: {
  rows: SkuRow[];
  /** The last-applied hand-picked selection (from the chunked cookies) — the staged baseline. */
  initialSelection: string[];
  /** Suppliers for the bulk "link selected SKUs to a supplier" action. */
  suppliers?: Supplier[];
  /** Named selection presets — apply/save/delete. */
  presets?: FilterPreset[];
  isHead?: boolean;
}) {
  const router = useRouter();
  const [globalSearch, setGlobalSearch] = useState('');
  const [addingSku, setAddingSku] = useState(false);

  // Per-column autofilters + a single active sort.
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [openCol, setOpenCol] = useState<{ key: string; x: number; y: number } | null>(null);

  const patchFilter = (key: string, patch: Partial<ColFilter> | null) =>
    setColFilters((prev) => {
      if (patch === null) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...prev[key], ...patch } };
    });

  // Distinct values per column (for the enum checklists) — from ALL rows.
  const distinctByCol = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      if (col.type !== 'enum') continue;
      out[col.key] = [...new Set(rows.map((r) => String(col.get(r))))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      );
    }
    return out;
  }, [rows]);

  // ── Staged selection: checkbox edits are local; "Aplicar seleção ao app" writes the
  // vg:skus* cookies so every analysis narrows to it (no selection = full catalog). A dirty
  // indicator shows unapplied changes. ────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [applied, setApplied] = useState<Set<string>>(() => new Set(initialSelection));
  const [capHit, setCapHit] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const dirty = !setsEqual(selected, applied);

  const stage = (next: Set<string>) => {
    setSelected(next);
    setApplyMsg(null);
  };
  const toggle = (skuBase: string) => {
    const next = new Set(selected);
    if (next.has(skuBase)) next.delete(skuBase);
    else {
      if (next.size >= MAX_SELECTED_SKUS) {
        setCapHit(true);
        return;
      }
      next.add(skuBase);
    }
    setCapHit(false);
    stage(next);
  };

  const applySelection = () => {
    writeSkusCookies([...selected]);
    setApplied(new Set(selected));
    setApplyMsg(
      selected.size === 0
        ? 'Seleção limpa — as análises mostram o catálogo inteiro.'
        : `Seleção aplicada — ${selected.size} SKU${selected.size > 1 ? 's' : ''} nas análises.`,
    );
  };
  const revertSelection = () => {
    setSelected(new Set(applied));
    setCapHit(false);
    setApplyMsg(null);
  };

  // Filtering + sorting (spreadsheet autofilter).
  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q)) return false;
      for (const col of COLUMNS) {
        const f = colFilters[col.key];
        if (!f) continue;
        if (col.type === 'text') {
          if (f.search && !String(col.get(r)).toLowerCase().includes(f.search.toLowerCase())) return false;
        } else if (col.type === 'enum') {
          if (f.checked != null && !f.checked.includes(String(col.get(r)))) return false;
        } else {
          const n = Number(col.get(r));
          if (f.min != null && n < f.min) return false;
          if (f.max != null && n > f.max) return false;
        }
      }
      return true;
    });
    if (sort) {
      const col = COLUMNS.find((c) => c.key === sort.key);
      if (col) {
        const val = col.sortGet ?? col.get;
        const mul = sort.dir === 'asc' ? 1 : -1;
        out.sort((a, b) => {
          const va = val(a);
          const vb = val(b);
          if (typeof va === 'number' && typeof vb === 'number') return mul * (va - vb);
          return mul * String(va).localeCompare(String(vb), 'pt-BR');
        });
      }
    }
    return out;
  }, [rows, globalSearch, colFilters, sort]);

  const anyFilter = globalSearch || Object.keys(colFilters).length > 0 || sort != null;
  const clearAllFilters = () => {
    setGlobalSearch('');
    setColFilters({});
    setSort(null);
  };

  // DOM relief: render at most `visibleCount` rows. Selection/bulk/counters operate on the
  // full `filtered` set, never the slice.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS);
  }, [globalSearch, colFilters, sort]);
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
    stage(next);
  };
  const clearSelection = () => {
    setCapHit(false);
    stage(new Set());
  };

  // Presets: apply loads into the STAGED selection (commit via Aplicar); save snapshots the
  // staged selection under a name (Head).
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetPending, startPreset] = useTransition();
  const [presetMsg, setPresetMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.presetId === id);
    if (!p) return;
    setCapHit(false);
    stage(new Set(p.skus.slice(0, MAX_SELECTED_SKUS)));
    setPresetMsg({ tone: 'ok', text: `Preset “${p.name}” carregado (${p.skus.length}). Clique em Aplicar.` });
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

  // Bulk-link the staged selection to one supplier.
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

  // CSV = the FULL filtered set, every remaining column.
  const exportCsv = () => {
    const header = [
      'sku', 'nome', 'classe', 'status', 'estoque_total', 'osasco', 'mooca', 'sbc',
      'consumo_dia', 'recuperavel', 'taxa_recuperacao_pct', 'turnaround_dias',
      'fornecedor', 'origem', 'ruptura', 'selecionado',
    ];
    const lines = filtered.map((r) =>
      [
        r.skuBase,
        `"${r.skuName.replace(/"/g, '""')}"`,
        r.abcClass,
        r.status,
        r.onHand,
        r.byHub.osasco,
        r.byHub.mooca,
        r.byHub.sbc,
        r.dailyDemand.toFixed(2),
        r.isRepairable ? 'sim' : 'nao',
        r.isRepairable ? Math.round(r.recoveryRate * 100) : '',
        r.isRepairable ? r.recoveryTurnaroundDays : '',
        r.supplierName ? `"${r.supplierName.replace(/"/g, '""')}"` : '',
        r.isNational ? 'nacional' : 'internacional',
        r.stockoutDate ?? '',
        selected.has(r.skuBase) ? 'sim' : 'nao',
      ].join(','),
    );
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estoque-skus-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openColDef = openCol ? COLUMNS.find((c) => c.key === openCol.key) ?? null : null;

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

      {/* Toolbar: global search + apply-selection + CSV + counts */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />
        {anyFilter && (
          <button onClick={clearAllFilters} className="text-[11px] text-muted-foreground hover:text-foreground">
            Limpar filtros
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Apply selection to the engine (app-wide) */}
        <button
          onClick={applySelection}
          disabled={!dirty}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
            dirty ? 'bg-brand-500 text-white hover:bg-brand-400' : 'bg-muted/60 text-muted-foreground',
          )}
          title="Grava a seleção atual para todas as análises (Estoque, Projeção Global, Novo Pedido…)"
        >
          <ListChecks size={14} /> Aplicar seleção ao app
        </button>
        {dirty && (
          <span className="text-[11px] font-medium text-amber-600 dark:text-alert-warning">
            {selected.size} selec. — alterações não aplicadas
            <button onClick={revertSelection} className="ml-1 underline hover:text-foreground">reverter</button>
          </span>
        )}
        {!dirty && applyMsg && <span className="text-[11px] text-alert-success">{applyMsg}</span>}
        {!dirty && !applyMsg && (
          <span className="text-[11px] text-muted-foreground">
            {applied.size > 0 ? `${applied.size} SKU(s) aplicados às análises` : 'Sem seleção — análises usam o catálogo inteiro'}
          </span>
        )}

        <button
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
          title="Exportar o conjunto filtrado completo"
        >
          <Download size={13} /> Exportar CSV
        </button>
        <span className="text-[11px] text-muted-foreground">{filtered.length} / {rows.length} SKUs</span>
      </div>

      {capHit && (
        <p className="mb-3 rounded-lg bg-alert-warning/10 px-3 py-1.5 text-xs text-[color:var(--color-alert-warning)] ring-1 ring-alert-warning/30">
          Limite de {MAX_SELECTED_SKUS} SKUs selecionados. Use os filtros de coluna para conjuntos maiores.
        </p>
      )}

      {/* Presets */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <Chip label="Presets" />
        <select
          value={presetId}
          onChange={(e) => applyPreset(e.target.value)}
          className="h-7 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
        >
          <option value="">Carregar preset…</option>
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

      {/* Selection summary + bulk-link */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-500/10 px-3 py-2 text-xs ring-1 ring-brand-500/20">
          <Check size={14} className="text-brand-600" />
          <span className="font-medium text-brand-600">
            {selected.size} SKU{selected.size > 1 ? 's' : ''} selecionado{selected.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={clearSelection}
            className="ml-auto rounded px-2 py-0.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Limpar seleção
          </button>
          {isHead && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-brand-500/20 pt-2">
              <Link2 size={13} className="text-brand-600" />
              <span className="font-medium text-foreground">Vincular seleção a fornecedor:</span>
              {activeSuppliers.length === 0 ? (
                <Link href="/dashboard/fornecedores" className="text-brand-600 underline hover:text-brand-500">
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
                    <span className={bulkMsg.tone === 'ok' ? 'text-alert-success' : 'text-alert-error'}>{bulkMsg.text}</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
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
              {COLUMNS.map((col) => (
                <ColHeader
                  key={col.key}
                  col={col}
                  active={filterActive(col, colFilters[col.key]) || sort?.key === col.key}
                  sortDir={sort?.key === col.key ? sort.dir : null}
                  onOpen={(x, y) => setOpenCol({ key: col.key, x, y })}
                  numeric={col.type === 'num'}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-sm text-muted-foreground">
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
                    <td className="px-3 py-2 max-w-[200px]">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(r.skuBase)}`}
                        className="truncate block text-foreground hover:text-brand-500 transition-colors"
                      >
                        {r.skuName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ABC_CLASS[r.abcClass] ?? 'text-muted-foreground')}>
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
                    <td className="px-3 py-2">
                      <RecoveryCell row={r} editable={isHead} />
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs text-muted-foreground" title={r.supplierName ?? undefined}>
                      {r.supplierName ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CLASS[r.status])}>
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

      {/* Column autofilter popover (fixed-positioned so the table's overflow can't clip it) */}
      {openCol && openColDef && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenCol(null)} />
          <ColumnFilterPopover
            col={openColDef}
            state={colFilters[openColDef.key]}
            distinct={distinctByCol[openColDef.key] ?? []}
            sort={sort?.key === openColDef.key ? sort.dir : null}
            x={openCol.x}
            y={openCol.y}
            onSort={(dir) => {
              setSort(dir ? { key: openColDef.key, dir } : null);
            }}
            onChange={(patch) => patchFilter(openColDef.key, patch)}
            onClose={() => setOpenCol(null)}
          />
        </>
      )}
    </div>
  );
}

// ── Column header: label + a funnel that highlights when the column is filtered/sorted. ──
function ColHeader({
  col,
  active,
  sortDir,
  onOpen,
  numeric,
}: {
  col: ColDef;
  active: boolean;
  sortDir: 'asc' | 'desc' | null;
  onOpen: (x: number, y: number) => void;
  numeric: boolean;
}) {
  return (
    <th className={cn('px-3 py-2.5 font-medium', numeric && 'text-right')}>
      <button
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onOpen(r.left, r.bottom);
        }}
        className={cn(
          'inline-flex items-center gap-1 font-medium uppercase tracking-wide transition-colors hover:text-foreground',
          active ? 'text-brand-600' : undefined,
        )}
        title="Filtrar / ordenar"
      >
        {col.label}
        {sortDir === 'asc' && <ArrowUp size={11} />}
        {sortDir === 'desc' && <ArrowDown size={11} />}
        <Filter size={11} className={active ? 'opacity-100' : 'opacity-40'} />
      </button>
    </th>
  );
}

function ColumnFilterPopover({
  col,
  state,
  distinct,
  sort,
  x,
  y,
  onSort,
  onChange,
  onClose,
}: {
  col: ColDef;
  state: ColFilter | undefined;
  distinct: string[];
  sort: 'asc' | 'desc' | null;
  x: number;
  y: number;
  onSort: (dir: 'asc' | 'desc' | null) => void;
  onChange: (patch: Partial<ColFilter> | null) => void;
  onClose: () => void;
}) {
  const [listSearch, setListSearch] = useState('');
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 260);
  const allowed = state?.checked; // undefined = all
  const shownValues = distinct.filter((v) => v.toLowerCase().includes(listSearch.toLowerCase()));

  const toggleValue = (v: string) => {
    const cur = allowed ?? distinct;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ checked: next.length === distinct.length ? undefined : next });
  };

  return (
    <div
      className="fixed z-50 w-60 rounded-lg border border-border bg-popover p-2 text-xs shadow-lg"
      style={{ left, top: y + 4 }}
    >
      {/* Sort */}
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => onSort(sort === 'asc' ? null : 'asc')}
          className={cn('inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium',
            sort === 'asc' ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 hover:bg-muted')}
        >
          <ArrowUp size={12} /> {col.type === 'num' ? 'Menor→maior' : 'A→Z'}
        </button>
        <button
          onClick={() => onSort(sort === 'desc' ? null : 'desc')}
          className={cn('inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-medium',
            sort === 'desc' ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 hover:bg-muted')}
        >
          <ArrowDown size={12} /> {col.type === 'num' ? 'Maior→menor' : 'Z→A'}
        </button>
      </div>

      {/* Type-specific filter */}
      {col.type === 'text' && (
        <input
          autoFocus
          value={state?.search ?? ''}
          onChange={(e) => onChange(e.target.value ? { search: e.target.value } : { search: undefined })}
          placeholder={`Contém… (${col.label})`}
          className="mb-1 h-8 w-full rounded-md border border-border bg-background px-2 outline-none focus:border-brand-500"
        />
      )}

      {col.type === 'num' && (
        <div className="mb-1 flex items-center gap-1">
          <input
            type="number"
            value={state?.min ?? ''}
            onChange={(e) => onChange({ min: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="mín"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            value={state?.max ?? ''}
            onChange={(e) => onChange({ max: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="máx"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500"
          />
        </div>
      )}

      {col.type === 'enum' && (
        <>
          {distinct.length > 8 && (
            <input
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Buscar valor…"
              className="mb-1 h-7 w-full rounded-md border border-border bg-background px-2 outline-none focus:border-brand-500"
            />
          )}
          <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <button onClick={() => onChange({ checked: undefined })} className="hover:text-foreground">Todos</button>
            <button onClick={() => onChange({ checked: [] })} className="hover:text-foreground">Nenhum</button>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-md border border-border/60">
            {shownValues.map((v) => {
              const checked = allowed == null || allowed.includes(v);
              return (
                <label key={v} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-muted/50">
                  <input type="checkbox" checked={checked} onChange={() => toggleValue(v)} className="size-3.5 accent-brand-500" />
                  <span className="truncate">{v}</span>
                </label>
              );
            })}
            {shownValues.length === 0 && <p className="px-2 py-1 text-muted-foreground">nenhum valor</p>}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => {
            onChange(null);
            onSort(null);
          }}
          className="text-[11px] text-muted-foreground hover:text-alert-error"
        >
          Limpar coluna
        </button>
        <button onClick={onClose} className="rounded-md bg-brand-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-brand-400">
          Fechar
        </button>
      </div>
    </div>
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
        className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', repairable ? 'bg-brand-500' : 'bg-muted-foreground/30')}
      >
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform', repairable ? 'left-3.5' : 'left-0.5')} />
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

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50';

// Register a brand-new SKU: its planning attributes (lead times, national/international,
// default modal, ABC) + display name. Writes a policy row via createSku, then the page
// refreshes and the SKU appears (zero stock until inventory for it lands).
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

/** Tiny uppercase label between control groups. */
function Chip({ label }: { label: string }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{label}</span>;
}
