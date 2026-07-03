'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import type { PurchaseStatus, TransportModal } from '@/types/planning';
import { MAX_SELECTED_SKUS, type PlanningFilter } from '@/lib/planning/filter';
import { writeFilterCookie, writeSkusCookies } from '@/lib/planning/applyFilter';
import { createSku, setSkuScope } from '@/app/dashboard/skus/actions';
import { cn } from '@/lib/utils';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { InfoHint } from '@/components/planning/InfoHint';

export interface SkuRow {
  skuBase: string;
  skuName: string;
  category: string | null;
  abcClass: string;
  onHand: number;
  dohDays: number | null;
  status: PurchaseStatus;
  stockoutDate: string | null;
  isLate: boolean;
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
  filter,
  scopeSkus,
  matchingSkus,
  filterSignature,
  isHead = false,
}: {
  rows: SkuRow[];
  filter: PlanningFilter;
  /** sku_bases in the active default universe (sub-project A). Undefined = no scope defined. */
  scopeSkus?: string[];
  /** SKUs matching the current TOP filter (Com previsão / Modelos / categoria). When set
   *  (a top filter is active), the selection syncs to it — filtering checks/unchecks. null
   *  = no top filter active → the selection is left alone. */
  matchingSkus?: string[] | null;
  /** Serialized top-filter state — the sync effect fires only when this changes. */
  filterSignature?: string;
  /** Only Heads may edit the scope. */
  isHead?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [abcFilter, setAbcFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | null>(null);
  const [addingSku, setAddingSku] = useState(false);

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

  // Hand-picked focus set (single-SKU control). Lives in the shared `vg:filter`
  // cookie so it narrows every other analysis. This page is exempt from that
  // narrowing (it's the manager), so toggling only writes the cookie + updates
  // local state — no server refresh needed, keeping checkboxes instant.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(filter.skus));
  const [capHit, setCapHit] = useState(false);

  const persist = (next: Set<string>) => {
    setSelected(next);
    // The selection lives in its own chunked cookies (it can be large) — not in vg:filter.
    writeSkusCookies([...next]);
  };

  // The top filters (Com previsão / Modelos / categoria) drive the selection: when a top
  // filter is active, sync the selection to exactly the SKUs it matches — filtering
  // checks/unchecks. Fires only when the filter changes, so manual checkbox edits persist.
  useEffect(() => {
    if (matchingSkus == null) return; // no top filter active → leave the selection alone
    persist(new Set(matchingSkus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

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

  // Category is the APP-WIDE scope filter (drives every page + syncs with the top
  // bar): write the shared cookie and refresh so the server re-renders the set.
  const setCategory = (v: string | null) => {
    writeFilterCookie({ ...filter, category: v });
    router.refresh();
  };

  // ABC / status / search / scope are local refinements within the already-narrowed set.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.skuName.toLowerCase().includes(q) && !r.skuBase.toLowerCase().includes(q))
        return false;
      if (abcFilter && r.abcClass !== abcFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (scopeFilter === 'in' && !scope.has(r.skuBase)) return false;
      if (scopeFilter === 'out' && scope.has(r.skuBase)) return false;
      return true;
    });
  }, [rows, search, abcFilter, statusFilter, scopeFilter, scope]);

  // DOM relief: render at most `visibleCount` rows (the full catalog can exceed 1000
  // <tr>s) with a "Mostrar mais" escape hatch. IMPORTANT: selection/bulk actions and
  // the counters keep operating on `filtered` (ALL matching rows), never the slice —
  // the in-table search/filters are the supported way to find a row (not ctrl+F).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ROWS);
  }, [search, abcFilter, statusFilter, scopeFilter, filter.category]);
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

  const localActive = abcFilter || statusFilter || search;
  const clearAll = () => {
    setAbcFilter(null);
    setStatusFilter(null);
    setSearch('');
    if (filter.category != null) setCategory(null);
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

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />

        {/* Category chips — app-wide (Moto/Bateria), synced with the top filter bar */}
        <span className="ml-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Categoria
        </span>
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            onClick={() => setCategory(c.v)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              filter.category === c.v
                ? 'bg-brand-500/20 text-brand-600'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {c.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-border" />

        {/* ABC chips — local refinement */}
        {['A', 'B', 'C'].map((cls) => (
          <button
            key={cls}
            onClick={() => setAbcFilter(abcFilter === cls ? null : cls)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              abcFilter === cls
                ? 'bg-brand-500/20 text-brand-600'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            Classe {cls}
          </button>
        ))}

        {/* Status chips — local refinement */}
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

        {(localActive || filter.category != null) && (
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
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
              Escopo
            </span>
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
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 font-medium">Categ.</th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Classe <InfoHint id="abc-class" /></span>
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">Estoque <InfoHint id="onhand" /></span>
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">Cobertura <InfoHint id="sku-doh" /></span>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Status <InfoHint id="purchase-status" /></span>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Ruptura <InfoHint id="stockout-date" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={hasScope ? 10 : 9} className="px-3 py-8 text-center text-sm text-muted-foreground">
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
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.dohDays != null ? `${fmtInt(r.dohDays)}d` : '—'}
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
