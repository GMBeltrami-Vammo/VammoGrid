'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Download, Ship, Plane, CheckSquare, SlidersHorizontal, Square, Trash2 } from 'lucide-react';
import type { ElaborationRow } from '@/lib/planning/load';
import type { TransportModal } from '@/types/planning';
import type { OrderType } from '@/types';
import type { OrderRules } from '@/lib/planning/elaboration';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import { createPedido } from '@/app/dashboard/pedidos/actions';
import { groupBySupplier } from '@/lib/planning/supplierGroups';
import { minDohWithin, projectFromSeed } from '@/lib/planning/miniStrip';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { DateField } from '@/components/ui/DateField';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

type ModalFilter = 'all' | 'air' | 'sea';

interface SupplierOption {
  supplierId: string;
  name: string;
  kind: OrderType;
  leadTimeSeaDays: number | null;
  leadTimeAirDays: number | null;
}

// "Novo Pedido" builder: the SKUs that need buying (DOH<floor in the horizon), each
// with a checkbox + editable qty; the MODAL is one global choice for the whole order;
// "Criar pedido" writes a single pedido (one VO, all checked SKUs as lines).

export function ProcurementView({
  rows,
  isHead,
  criteria,
  rules,
  today,
  forecastAsOf,
  suppliers = [],
  prefBySku = {},
  skusBySupplier = {},
}: {
  rows: ElaborationRow[];
  isHead: boolean;
  /** Global Admin criteria — the defaults the per-pedido rules panel starts from. */
  criteria: PurchaseCriteria;
  /** Per-pedido overrides currently applied (from the URL), if any. */
  rules: OrderRules | null;
  today: string;
  /** asOfDate of the forecast — frozen into the pedido at creation (item 8). */
  forecastAsOf: string;
  /** Active suppliers (review 4b) — the header selector (required), type + line lead. */
  suppliers?: SupplierOption[];
  /** skuBase → preferred supplier_id (review 4b) — drives the per-supplier split. */
  prefBySku?: Record<string, string>;
  /** supplier_id → all linked sku_bases — the builder shows only the chosen supplier's SKUs. */
  skusBySupplier?: Record<string, string[]>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const [modalFilter, setModalFilter] = useState<ModalFilter>('all');
  // DOH filter reorganizado: (1) cobertura = horizonte que o filtro enxerga; (2) estoque
  // mínimo DOH — o SKU aparece se ALGUM dia dentro da cobertura tiver DOH < esse valor.
  const [covWeeks, setCovWeeks] = useState(16);
  const [minDohFilter, setMinDohFilter] = useState('');
  const [modal, setModal] = useState<TransportModal>('sea');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [pedidoName, setPedidoName] = useState('');
  // Supplier is REQUIRED (todo Novo Pedido tem fornecedor). Preselect when there's only
  // one active supplier (today: VMoto). Type (nac/int) is DERIVED from the supplier.
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.supplierId, s])), [suppliers]);
  const [supplierId, setSupplierId] = useState(suppliers.length === 1 ? suppliers[0].supplierId : '');
  const selectedSupplier = supplierById.get(supplierId) ?? null;
  const orderType: OrderType = selectedSupplier?.kind ?? 'internacional';
  // Per-SKU inclusion + qty. Default: all included at the suggested qty for the default
  // modal (sea). Flipping the modal resets quantities to that modal's suggestion.
  const [included, setIncluded] = useState<Set<string>>(() => new Set(rows.map((r) => r.suggestion.skuBase)));
  const [qtys, setQtys] = useState<Record<string, number>>(
    () => Object.fromEntries(rows.map((r) => [r.suggestion.skuBase, r.suggestedQtySea])),
  );

  const chooseModal = (m: TransportModal) => {
    setModal(m);
    setQtys(Object.fromEntries(rows.map((r) => [r.suggestion.skuBase, suggestedFor(r, m)])));
  };

  // "Regras deste pedido" (7b): overrides vivem na URL — Aplicar recomputa no server
  // com elas; o critério global do Admin segue sendo o default (e o heatmap não muda).
  const [rulesOpen, setRulesOpen] = useState(rules != null);
  const [rFloor, setRFloor] = useState(String(rules?.seaFloorDoh ?? criteria.dohThreshold));
  const [rCadence, setRCadence] = useState(String(rules?.seaCadenceDays ?? 30));
  const offsetToDate = (off: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + off);
    return d.toISOString().slice(0, 10);
  };
  const dateToOffset = (iso: string) =>
    Math.max(
      0,
      Math.round(
        (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
      ),
    );
  const [rPeriods, setRPeriods] = useState<{ date: string; minDoh: string }[]>(() =>
    (rules?.airPeriods ?? []).map((p) => ({ date: offsetToDate(p.fromOffset), minDoh: String(p.minDoh) })),
  );

  const applyRules = () => {
    const floor = Number(rFloor);
    const cadence = Number(rCadence);
    const next: OrderRules = {};
    if (Number.isFinite(floor) && floor > 0 && Math.round(floor) !== criteria.dohThreshold)
      next.seaFloorDoh = Math.round(floor);
    if (Number.isFinite(cadence) && cadence > 0 && Math.round(cadence) !== 30)
      next.seaCadenceDays = Math.round(cadence);
    const periods = rPeriods
      .map((p) => ({ fromOffset: dateToOffset(p.date), minDoh: Math.round(Number(p.minDoh)) }))
      .filter((p) => Number.isFinite(p.minDoh) && p.minDoh > 0);
    if (periods.length > 0) next.airPeriods = periods;
    router.push(
      Object.keys(next).length === 0
        ? pathname
        : `${pathname}?rules=${encodeURIComponent(JSON.stringify(next))}`,
    );
  };
  const clearRules = () => {
    setRFloor(String(criteria.dohThreshold));
    setRCadence('30');
    setRPeriods([]);
    router.push(pathname);
  };
  const [error, setError] = useState<string | null>(null);
  const [createdVo, setCreatedVo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // When a supplier is chosen, the builder shows ONLY that supplier's linked SKUs.
  const supplierSkuSet = useMemo(
    () => (supplierId ? new Set(skusBySupplier[supplierId] ?? []) : null),
    [supplierId, skusBySupplier],
  );

  // Baseline (registered-orders-only) projection per SKU, re-projected client-side from
  // the seed — powers both the DOH-over-horizon filter and (later) the mini-heatmap.
  const baselineBySku = useMemo(() => {
    const m = new Map<string, ReturnType<typeof projectFromSeed>>();
    for (const r of rows) m.set(r.suggestion.skuBase, projectFromSeed(r.miniSeed, [], today));
    return m;
  }, [rows, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minDoh = minDohFilter.trim() ? Number(minDohFilter) : null;
    const covDays = covWeeks * 7;
    return rows.filter((r) => {
      const s = r.suggestion;
      if (supplierSkuSet && !supplierSkuSet.has(s.skuBase)) return false;
      if (q && !s.skuBase.toLowerCase().includes(q) && !(s.skuName ?? '').toLowerCase().includes(q)) return false;
      if (modalFilter !== 'all' && s.suggestedModal !== modalFilter) return false;
      if (minDoh != null && Number.isFinite(minDoh)) {
        // Show only if some day within the coverage horizon dips below the min DOH.
        const proj = baselineBySku.get(s.skuBase);
        const lowest = proj ? minDohWithin(proj, covDays) : null;
        if (lowest == null || lowest >= minDoh) return false;
      }
      return true;
    });
  }, [rows, search, modalFilter, minDohFilter, covWeeks, supplierSkuSet, baselineBySku]);

  // Only the chosen supplier's SKUs enter the order (independent of the transient
  // search/modal/DOH filters, which shouldn't drop already-selected lines).
  const selectedRows = rows.filter(
    (r) =>
      included.has(r.suggestion.skuBase) &&
      (qtys[r.suggestion.skuBase] ?? 0) > 0 &&
      (!supplierSkuSet || supplierSkuSet.has(r.suggestion.skuBase)),
  );
  const selectedCount = selectedRows.length;
  const selectedUnits = selectedRows.reduce((s, r) => s + (qtys[r.suggestion.skuBase] ?? 0), 0);

  const toggle = (sku: string) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });

  const allVisibleIncluded = filtered.length > 0 && filtered.every((r) => included.has(r.suggestion.skuBase));
  const toggleAllVisible = () =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (allVisibleIncluded) filtered.forEach((r) => next.delete(r.suggestion.skuBase));
      else filtered.forEach((r) => next.add(r.suggestion.skuBase));
      return next;
    });
  // Explicit bulk actions (in addition to the header checkbox): select every currently
  // visible (filtered) SKU, or clear the whole selection.
  const selectVisible = () =>
    setIncluded((prev) => {
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.suggestion.skuBase));
      return next;
    });
  const clearSelection = () => setIncluded(new Set());

  // Shared payload builder — the audit basis (item 8) is identical across the single-
  // order and per-supplier flows.
  const auditObj = {
    forecastAsOf,
    criteria: rules?.seaFloorDoh ? { ...criteria, dohThreshold: rules.seaFloorDoh } : criteria,
    rules: rules ?? undefined,
  };
  const lineFor = (r: ElaborationRow, sup: SupplierOption | null = selectedSupplier) => ({
    skuBase: r.suggestion.skuBase,
    skuName: r.suggestion.skuName,
    qty: qtys[r.suggestion.skuBase] ?? 0,
    // Lead comes from the pedido's supplier (fallback to the SKU's own lead).
    leadDays:
      (modal === 'sea' ? sup?.leadTimeSeaDays : sup?.leadTimeAirDays) ??
      (modal === 'sea' ? r.suggestion.leadTimeSeaDays : r.suggestion.leadTimeAirDays),
    suggestedQty: suggestedFor(r, modal),
    suggestedModal: r.suggestion.suggestedModal,
  });

  const criarPedido = () => {
    setError(null);
    setCreatedVo(null);
    if (!selectedSupplier) {
      setError('Selecione um fornecedor para o pedido.');
      return;
    }
    startTransition(async () => {
      const res = await createPedido({
        modal,
        orderDate,
        pedidoName: pedidoName || null,
        orderType,
        supplierId: selectedSupplier.supplierId,
        supplierName: selectedSupplier.name,
        lines: selectedRows.map((r) => lineFor(r)),
        audit: auditObj,
      });
      if (res.ok) {
        setCreatedVo(res.vo ?? null);
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao criar pedido.');
      }
    });
  };

  // "Pedido por fornecedor" (review 4b): split the selection by each SKU's preferred
  // supplier and create ONE pedido per supplier — type + lead come from each group's
  // supplier. SKUs with no preferred supplier are SKIPPED (todo pedido tem fornecedor).
  const criarPorFornecedor = () => {
    setError(null);
    setCreatedVo(null);
    const groups = groupBySupplier(
      selectedRows.map((r) => ({ skuBase: r.suggestion.skuBase, row: r })),
      new Map(Object.entries(prefBySku)),
    );
    const withSupplier = groups.filter((g) => g.supplierId && supplierById.has(g.supplierId));
    const skipped = selectedRows.length - withSupplier.reduce((n, g) => n + g.items.length, 0);
    if (withSupplier.length === 0) {
      setError('Nenhum SKU selecionado tem fornecedor preferido. Vincule fornecedores primeiro.');
      return;
    }
    startTransition(async () => {
      let created = 0;
      for (const g of withSupplier) {
        const sup = supplierById.get(g.supplierId!)!;
        const res = await createPedido({
          modal,
          orderDate,
          pedidoName: pedidoName ? `${pedidoName} · ${sup.name}` : sup.name,
          orderType: sup.kind,
          supplierId: sup.supplierId,
          supplierName: sup.name,
          lines: g.items.map((it) => lineFor(it.row, sup)),
          audit: auditObj,
        });
        if (!res.ok) {
          setError(`Erro no fornecedor ${sup.name}: ${res.error ?? 'falha'} (${created} pedido(s) criado(s) antes).`);
          router.refresh();
          return;
        }
        created++;
      }
      setError(skipped > 0 ? `${created} pedido(s) criado(s). ${skipped} SKU(s) sem fornecedor foram ignorados.` : null);
      router.refresh();
    });
  };
  const distinctSuppliersInSelection = new Set(
    selectedRows.map((r) => prefBySku[r.suggestion.skuBase] ?? '∅'),
  ).size;

  const exportCsv = () => {
    const header = ['sku', 'nome', 'doh_hoje', 'consumo_dia', 'ruptura', 'chegada', 'qtd', 'incluido'];
    const lines = filtered.map((r) => {
      const s = r.suggestion;
      return [
        s.skuBase,
        `"${(s.skuName ?? '').replace(/"/g, '""')}"`,
        s.dohNow != null ? Math.round(s.dohNow) : '',
        s.dailyDemand.toFixed(2),
        s.firstBreachDate ?? '',
        s.expectedArrival ?? '',
        qtys[s.skuBase] ?? 0,
        included.has(s.skuBase) ? 'sim' : 'nao',
      ].join(',');
    });
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novo-pedido-${orderDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Order-level controls */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Modal do pedido</span>
          <div className="mt-1 inline-flex overflow-hidden rounded-md border border-border">
            {(['sea', 'air'] as TransportModal[]).map((m) => (
              <button
                key={m}
                onClick={() => chooseModal(m)}
                className={cn(
                  'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors',
                  modal === m ? 'bg-brand-500 text-white' : 'bg-card text-muted-foreground hover:bg-muted/50',
                )}
              >
                {m === 'sea' ? <Ship size={13} /> : <Plane size={13} />}
                {m === 'sea' ? 'Marítimo' : 'Aéreo'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Data do pedido</span>
          <DateField value={orderDate} onChange={setOrderDate} className="mt-1 h-8 w-36" aria-label="Data do pedido" />
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Nome do pedido</span>
          <input
            value={pedidoName}
            onChange={(e) => setPedidoName(e.target.value)}
            placeholder="Ex.: Reposição agosto"
            className="mt-1 h-8 w-48 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
          />
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Fornecedor <span className="text-alert-error">*</span>
          </span>
          {suppliers.length > 0 ? (
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={cn(
                'mt-1 h-8 w-52 rounded-md border bg-background px-2 text-sm outline-none focus:border-brand-500',
                supplierId ? 'border-border' : 'border-alert-error/50',
              )}
            >
              <option value="">Escolher fornecedor…</option>
              {suppliers.map((s) => (
                <option key={s.supplierId} value={s.supplierId}>
                  {s.name} ({s.kind === 'nacional' ? 'Nacional' : 'Internacional'})
                </option>
              ))}
            </select>
          ) : (
            <Link href="/dashboard/fornecedores" className="mt-1 block text-xs text-brand-600 underline hover:text-brand-500">
              cadastre um fornecedor primeiro
            </Link>
          )}
        </div>
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tipo</span>
          <span className="mt-1 inline-flex h-8 items-center rounded-md bg-muted/50 px-3 text-xs font-medium text-foreground">
            {selectedSupplier ? (orderType === 'internacional' ? 'Internacional' : 'Nacional') : '—'}
            <span className="ml-1 text-muted-foreground">(do fornecedor)</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCount}</span> SKUs · {fmtInt(selectedUnits)} un.
          </span>
          {isHead && (
            <>
              {suppliers.length > 0 && distinctSuppliersInSelection > 1 && (
                <button
                  onClick={criarPorFornecedor}
                  disabled={pending || selectedCount === 0}
                  title="Cria um pedido separado para cada fornecedor preferencial dos SKUs selecionados (SKUs sem fornecedor são ignorados)"
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-500/40 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-500/10 disabled:opacity-50"
                >
                  <Check size={15} /> Por fornecedor ({distinctSuppliersInSelection})
                </button>
              )}
              <button
                onClick={criarPedido}
                disabled={pending || selectedCount === 0 || !supplierId}
                title={!supplierId ? 'Selecione um fornecedor' : undefined}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
              >
                <Check size={15} /> {pending ? 'Criando…' : 'Criar pedido'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Regras deste pedido (7b) — override do critério global só para este cálculo */}
      <div className="mb-4 rounded-xl bg-card ring-1 ring-foreground/10">
        <button
          onClick={() => setRulesOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-muted/30"
        >
          <SlidersHorizontal size={14} className="text-muted-foreground" />
          Regras deste pedido
          {rules != null && (
            <span className="rounded-full bg-alert-warning/15 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--color-alert-warning)]">
              ativas — diferem do critério global ({criteria.dohThreshold}d)
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{rulesOpen ? 'ocultar' : 'configurar'}</span>
        </button>
        {rulesOpen && (
          <div className="border-t border-border/60 px-4 py-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Piso DOH (marítimo)
                </span>
                <input
                  type="number"
                  min={1}
                  value={rFloor}
                  onChange={(e) => setRFloor(e.target.value)}
                  className="mt-1 h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Periodicidade (dias)
                </span>
                <input
                  type="number"
                  min={1}
                  value={rCadence}
                  onChange={(e) => setRCadence(e.target.value)}
                  className="mt-1 h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
                />
              </label>
              <div className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Períodos aéreos (DOH mínimo a partir de…)
                </span>
                <div className="mt-1 space-y-1.5">
                  {rPeriods.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <DateField
                        value={p.date}
                        onChange={(v) => setRPeriods((ps) => ps.map((x, j) => (j === i ? { ...x, date: v } : x)))}
                        className="h-8 w-32"
                        aria-label="Início do período"
                      />
                      <span className="text-xs text-muted-foreground">→ DOH ≥</span>
                      <input
                        type="number"
                        min={1}
                        value={p.minDoh}
                        onChange={(e) =>
                          setRPeriods((ps) => ps.map((x, j) => (j === i ? { ...x, minDoh: e.target.value } : x)))
                        }
                        className="h-8 w-20 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500"
                      />
                      <button
                        onClick={() => setRPeriods((ps) => ps.filter((_, j) => j !== i))}
                        aria-label="Remover período"
                        className="text-muted-foreground hover:text-alert-error"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {rPeriods.length < 4 && (
                    <button
                      onClick={() => setRPeriods((ps) => [...ps, { date: today, minDoh: rFloor }])}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      + Adicionar período
                    </button>
                  )}
                </div>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={applyRules}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-400"
                >
                  Aplicar regras
                </button>
                <button
                  onClick={clearRules}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40"
                >
                  Voltar ao global
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Vale só para este cálculo (fica na URL — compartilhável). Marítimo repõe até piso + periodicidade;
              os períodos aéreos definem o DOH mínimo que a ponte aérea deve sustentar em cada trecho.
            </p>
          </div>
        )}
      </div>

      {error && <p className="mb-3 rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>}
      {createdVo && (
        <p className="mb-3 rounded-md bg-alert-success/10 px-3 py-2 text-sm text-alert-success">
          Pedido criado.{' '}
          <Link href={`/dashboard/pedidos/${encodeURIComponent(createdVo)}`} className="font-medium hover:underline">
            Ver {createdVo} →
          </Link>
        </p>
      )}

      {/* Filters + bulk selection */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-40 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 placeholder:text-muted-foreground/50"
        />

        {/* Modal-necessity chips */}
        {([
          ['all', 'Tudo'],
          ['air', 'Aéreo necessário'],
          ['sea', 'Marítimo'],
        ] as [ModalFilter, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setModalFilter(id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
              modalFilter === id ? 'bg-brand-500/20 text-brand-600' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {id === 'air' && <Plane size={11} />}
            {id === 'sea' && <Ship size={11} />}
            {label}
          </button>
        ))}

        {/* DOH filter: cobertura (horizonte) + estoque mínimo DOH */}
        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          Cobertura
          <select
            value={covWeeks}
            onChange={(e) => setCovWeeks(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
          >
            {[4, 8, 12, 16, 20].map((w) => (
              <option key={w} value={w}>{w} sem</option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          Estoque mín. DOH &lt;
          <input
            type="number"
            min={0}
            value={minDohFilter}
            onChange={(e) => setMinDohFilter(e.target.value)}
            placeholder="—"
            title="Mostra o SKU se algum dia dentro da cobertura tiver DOH abaixo deste valor"
            className="h-8 w-16 rounded-md border border-border bg-card px-2 text-right text-xs tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40"
          />
        </label>

        <span className="mx-0.5 h-4 w-px bg-border" />

        {/* Bulk selection */}
        {isHead && (
          <>
            <button
              onClick={selectVisible}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
            >
              <CheckSquare size={13} /> Selecionar visíveis
            </button>
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40"
            >
              <Square size={13} /> Limpar seleção
            </button>
          </>
        )}
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
        >
          <Download size={13} /> Exportar CSV
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {selectedCount} selec. · {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-3 py-2.5">
                {isHead && (
                  <input
                    type="checkbox"
                    aria-label="Incluir todos visíveis"
                    checked={allVisibleIncluded}
                    onChange={toggleAllVisible}
                    className="size-3.5 cursor-pointer accent-brand-500 align-middle"
                  />
                )}
              </th>
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Nome</th>
              <th className="px-3 py-2.5 text-right font-medium">DOH hoje</th>
              <th className="px-3 py-2.5 font-medium">Ruptura prev.</th>
              <th className="px-3 py-2.5 font-medium">
                <span className="inline-flex items-center gap-1">Comprar até <InfoHint id="buy-by" /></span>
              </th>
              <th className="px-3 py-2.5 font-medium">Chegada ({modal === 'sea' ? 'mar' : 'aéreo'})</th>
              <th className="px-3 py-2.5 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">Qtd sugerida <InfoHint id="order-qty" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum SKU precisa de pedido no horizonte (cobertura acima do piso).
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const s = r.suggestion;
                const leadDays = modal === 'sea' ? s.leadTimeSeaDays : s.leadTimeAirDays;
                const arrival = addDaysStr(orderDate, leadDays);
                const buyBy = signedAddDays(s.firstBreachDate, -leadDays);
                const isIn = included.has(s.skuBase);
                return (
                  <tr key={s.skuBase} className={cn('transition-colors', isIn ? 'bg-brand-500/[0.04]' : 'hover:bg-muted/30')}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${s.skuBase}`}
                        checked={isIn}
                        disabled={!isHead}
                        onChange={() => toggle(s.skuBase)}
                        className="size-3.5 cursor-pointer accent-brand-500 align-middle disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(s.skuBase)}`}
                        className="font-mono text-xs text-brand-500 hover:text-brand-400"
                      >
                        {s.skuBase}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">{s.skuName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.dohNow != null ? fmtInt(s.dohNow) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      <span className={s.isLate ? 'text-alert-error' : 'text-amber-600 dark:text-alert-warning'}>
                        {fmtDate(s.firstBreachDate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      {s.isLate ? (
                        <span className="inline-flex items-center rounded-full bg-alert-error/15 px-1.5 py-0.5 font-medium text-alert-error">
                          Atrasado
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{fmtDate(buyBy)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{fmtDate(arrival)}</td>
                    <td className="px-3 py-2 text-right">
                      {isHead ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <input
                            type="number"
                            min={0}
                            value={qtys[s.skuBase] ?? 0}
                            onChange={(e) => setQtys((p) => ({ ...p, [s.skuBase]: Number(e.target.value) }))}
                            className="h-7 w-24 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums outline-none focus:border-brand-500"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            sug. {fmtInt(suggestedFor(r, modal))}
                            {(qtys[s.skuBase] ?? 0) !== suggestedFor(r, modal) && (
                              <button
                                onClick={() => setQtys((p) => ({ ...p, [s.skuBase]: suggestedFor(r, modal) }))}
                                className="ml-1 text-brand-600 hover:underline"
                              >
                                redefinir
                              </button>
                            )}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/70" title="Plano combinado: aéreo (ponte) · marítimo (lote)">
                            <Plane size={8} /> {fmtInt(r.suggestedQtyAir)} · <Ship size={8} /> {fmtInt(r.suggestedQtySea)}
                          </span>
                        </div>
                      ) : (
                        <span className="tabular-nums">{fmtInt(qtys[s.skuBase] ?? 0)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Local DD-safe date add (client): orderDate + n days → YYYY-MM-DD.
function addDaysStr(iso: string, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(days)));
  return d.toISOString().slice(0, 10);
}

// Signed date add (allows going backwards — for the buy-by = breach − lead calc).
function signedAddDays(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// The suggested qty for the chosen order modal (combined plan: air bridge vs sea bulk).
const suggestedFor = (r: ElaborationRow, m: TransportModal) =>
  m === 'air' ? r.suggestedQtyAir : r.suggestedQtySea;
