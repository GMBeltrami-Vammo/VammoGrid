'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Download, Package, Plane, Ship, Truck, CheckSquare, SlidersHorizontal, Square, Trash2 } from 'lucide-react';
import type { ElaborationRow } from '@/lib/planning/load';
import type { OrderType, SupplierModal } from '@/types';
import { suggestQuantities, type ModalPlan, type OrderRules } from '@/lib/planning/elaboration';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import { createPedido, type NewPedidoLine } from '@/app/dashboard/pedidos/actions';
import { modalsForSupplier, type ModalOption } from '@/lib/planning/supplierGroups';
import { minDohWithin, projectFromSeed, sampleMiniStrip, type MiniCell } from '@/lib/planning/miniStrip';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { DateField } from '@/components/ui/DateField';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

type ModalFilter = 'all' | 'air' | 'sea';

// Weeks shown in the per-SKU mini-heatmap strip (kept fixed/compact so the column stays
// narrow regardless of the coverage-filter horizon).
const STRIP_WEEKS = 12;
const STRIP_OFFSETS = Array.from({ length: STRIP_WEEKS }, (_, i) => i * 7);

interface SupplierOption {
  supplierId: string;
  name: string;
  kind: OrderType;
  leadTimeSeaDays: number | null;
  leadTimeAirDays: number | null;
}

// "Novo Pedido" builder (N-modal). Flow: pick the supplier (required) → its transport
// modais appear (Courier/Aéreo/Marítimo…) as a multi-select → per (SKU × modal) suggested
// quantities come from suggestQuantities (fastest lanes bridge, slowest sustains order-up-to)
// → a per-line mini-heatmap shows coverage WITH the order → "Criar pedido" writes ONE pedido
// whose lines carry their own modal (the engine is modal-agnostic; timing = each lane's lead).
export function ProcurementView({
  rows,
  isHead,
  criteria,
  rules,
  today,
  forecastAsOf,
  suppliers = [],
  supplierModals = [],
  skusBySupplier = {},
}: {
  rows: ElaborationRow[];
  isHead: boolean;
  /** Global Admin criteria — the min-DOH the per-modal quantities target. */
  criteria: PurchaseCriteria;
  /** Per-pedido overrides currently applied (from the URL), if any. */
  rules: OrderRules | null;
  today: string;
  /** asOfDate of the forecast — frozen into the pedido at creation (item 8). */
  forecastAsOf: string;
  /** Active suppliers (review 4b) — the header selector (required), type + line lead. */
  suppliers?: SupplierOption[];
  /** All registered supplier modais — the chosen supplier's are the order's lanes. */
  supplierModals?: SupplierModal[];
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
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [pedidoName, setPedidoName] = useState('');

  // Supplier is REQUIRED. Preselect when there's only one active supplier (today: VMoto).
  // Type (nac/int) is DERIVED from the supplier.
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.supplierId, s])), [suppliers]);
  const initialSupplierId = suppliers.length === 1 ? suppliers[0].supplierId : '';
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const selectedSupplier = supplierById.get(supplierId) ?? null;
  const orderType: OrderType = selectedSupplier?.kind ?? 'internacional';

  // The chosen supplier's transport modais, ordered slow→fast (real supplier leads).
  const modalOptions = useMemo(
    () => modalsForSupplier(supplierById.get(supplierId) ?? null, supplierModals),
    [supplierId, supplierById, supplierModals],
  );
  // Which modais are part of this order (default: all of the supplier's). Reset when the
  // supplier changes (and clear any manual per-modal qty edits).
  const [enabledModals, setEnabledModals] = useState<Set<string>>(
    () => new Set(modalsForSupplier(supplierById.get(initialSupplierId) ?? null, supplierModals).map((m) => m.id)),
  );
  // Per-(sku × modalId) manual qty override; absent → the suggested qty is used.
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, Record<string, number>>>({});
  // Sustaining cadence (periodicidade) for the slowest lane: null = one-time.
  const [frequencyDays, setFrequencyDays] = useState<number | null>(30);
  useEffect(() => {
    const opts = modalsForSupplier(supplierById.get(supplierId) ?? null, supplierModals);
    setEnabledModals(new Set(opts.map((m) => m.id)));
    setQtyOverrides({});
  }, [supplierId, supplierById, supplierModals]);

  const enabledModalOptions = useMemo(
    () => modalOptions.filter((m) => enabledModals.has(m.id)),
    [modalOptions, enabledModals],
  );
  // Slowest enabled lane (modalOptions is DESC by lead) — the bulk lane, used for buy-by.
  const slowestLead = enabledModalOptions[0]?.leadDays ?? selectedSupplier?.leadTimeSeaDays ?? null;

  // The plans the qty engine runs: every enabled lane targets the global min DOH; the
  // cadence only bites on the slowest lane (suggestQuantities applies it there).
  const plans = useMemo<ModalPlan[]>(
    () =>
      enabledModalOptions.map((m) => ({
        modal: m,
        minDoh: criteria.dohThreshold,
        cadenceDays: frequencyDays,
        enabled: true,
      })),
    [enabledModalOptions, criteria.dohThreshold, frequencyDays],
  );

  const toggleModal = (id: string) =>
    setEnabledModals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  // the seed — powers the DOH-over-horizon filter and each row's mini-heatmap "sem" base.
  const baselineBySku = useMemo(() => {
    const m = new Map<string, ReturnType<typeof projectFromSeed>>();
    for (const r of rows) m.set(r.suggestion.skuBase, projectFromSeed(r.miniSeed, [], today));
    return m;
  }, [rows, today]);

  // Suggested qty per (sku → modalId) from the N-modal engine, against each SKU's baseline.
  const suggestedByModal = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    if (plans.length === 0) return out;
    for (const r of rows) {
      const proj = baselineBySku.get(r.suggestion.skuBase);
      if (!proj) continue;
      const qs = suggestQuantities({ projection: proj, plans });
      out.set(r.suggestion.skuBase, new Map(qs.map((q) => [q.modalId, q.qty])));
    }
    return out;
  }, [rows, baselineBySku, plans]);

  const suggestedFor = (sku: string, modalId: string) => suggestedByModal.get(sku)?.get(modalId) ?? 0;
  const qtyFor = (sku: string, modalId: string) => {
    const o = qtyOverrides[sku]?.[modalId];
    return o != null ? o : suggestedFor(sku, modalId);
  };
  const perSkuTotal = (sku: string) => enabledModalOptions.reduce((s, m) => s + qtyFor(sku, m.id), 0);

  const setQtyOverride = (sku: string, modalId: string, v: number) =>
    setQtyOverrides((prev) => ({ ...prev, [sku]: { ...prev[sku], [modalId]: Math.max(0, Math.round(v || 0)) } }));
  const clearQtyOverride = (sku: string, modalId: string) =>
    setQtyOverrides((prev) => {
      const s = { ...prev[sku] };
      delete s[modalId];
      const next = { ...prev };
      if (Object.keys(s).length) next[sku] = s;
      else delete next[sku];
      return next;
    });

  // Per-SKU "com pedido" coverage strip: baseline + this row's injected modal arrivals.
  const stripFor = (r: ElaborationRow): MiniCell[] => {
    const sku = r.suggestion.skuBase;
    const injected = enabledModalOptions
      .map((m) => ({ offset: m.leadDays, qty: qtyFor(sku, m.id) }))
      .filter((x) => x.qty > 0);
    const proj = projectFromSeed(r.miniSeed, injected, today);
    return sampleMiniStrip(proj, STRIP_OFFSETS, criteria.dohThreshold);
  };

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
        const proj = baselineBySku.get(s.skuBase);
        const lowest = proj ? minDohWithin(proj, covDays) : null;
        if (lowest == null || lowest >= minDoh) return false;
      }
      return true;
    });
  }, [rows, search, modalFilter, minDohFilter, covWeeks, supplierSkuSet, baselineBySku]);

  const [included, setIncluded] = useState<Set<string>>(() => new Set(rows.map((r) => r.suggestion.skuBase)));

  // Only the chosen supplier's SKUs with a positive total across the enabled modais.
  const selectedRows = rows.filter(
    (r) =>
      included.has(r.suggestion.skuBase) &&
      perSkuTotal(r.suggestion.skuBase) > 0 &&
      (!supplierSkuSet || supplierSkuSet.has(r.suggestion.skuBase)),
  );
  const selectedCount = selectedRows.length;
  const selectedUnits = selectedRows.reduce((s, r) => s + perSkuTotal(r.suggestion.skuBase), 0);

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
  const selectVisible = () =>
    setIncluded((prev) => {
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.suggestion.skuBase));
      return next;
    });
  const clearSelection = () => setIncluded(new Set());

  // Frozen elaboration basis (item 8) — records the criteria + rules + the modal plan.
  const auditObj = {
    forecastAsOf,
    criteria: rules?.seaFloorDoh ? { ...criteria, dohThreshold: rules.seaFloorDoh } : criteria,
    rules: rules ?? undefined,
    modalPlan: enabledModalOptions.map((m) => ({ id: m.id, name: m.name, leadDays: m.leadDays })),
    frequencyDays,
  };

  // One line per (SKU × enabled modal) with a positive qty — the engine treats each as
  // its own synthetic receipt, so a courier + aéreo + marítimo split lands as three lines.
  const linesFor = (r: ElaborationRow): NewPedidoLine[] =>
    enabledModalOptions
      .map((m) => ({
        skuBase: r.suggestion.skuBase,
        skuName: r.suggestion.skuName,
        qty: qtyFor(r.suggestion.skuBase, m.id),
        leadDays: m.leadDays,
        modal: m.name,
        suggestedQty: suggestedFor(r.suggestion.skuBase, m.id),
        suggestedModal: m.name,
      }))
      .filter((l) => l.qty > 0);

  const criarPedido = () => {
    setError(null);
    setCreatedVo(null);
    if (!selectedSupplier) {
      setError('Selecione um fornecedor para o pedido.');
      return;
    }
    if (enabledModalOptions.length === 0) {
      setError('Selecione ao menos um modal para o pedido.');
      return;
    }
    const lines = selectedRows.flatMap((r) => linesFor(r));
    if (lines.length === 0) {
      setError('Nenhuma linha com quantidade maior que zero.');
      return;
    }
    startTransition(async () => {
      const res = await createPedido({
        orderDate,
        pedidoName: pedidoName || null,
        orderType,
        supplierId: selectedSupplier.supplierId,
        supplierName: selectedSupplier.name,
        lines,
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

  const exportCsv = () => {
    const header = ['sku', 'nome', 'doh_hoje', 'consumo_dia', 'ruptura', 'total', 'modais'];
    const lines = filtered.map((r) => {
      const s = r.suggestion;
      const modais = enabledModalOptions
        .map((m) => `${m.name}:${qtyFor(s.skuBase, m.id)}`)
        .filter((x) => !x.endsWith(':0'))
        .join('|');
      return [
        s.skuBase,
        `"${(s.skuName ?? '').replace(/"/g, '""')}"`,
        s.dohNow != null ? Math.round(s.dohNow) : '',
        s.dailyDemand.toFixed(2),
        s.firstBreachDate ?? '',
        perSkuTotal(s.skuBase),
        `"${modais}"`,
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
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCount}</span> SKUs · {fmtInt(selectedUnits)} un.
          </span>
          {isHead && (
            <button
              onClick={criarPedido}
              disabled={pending || selectedCount === 0 || !supplierId || enabledModalOptions.length === 0}
              title={!supplierId ? 'Selecione um fornecedor' : undefined}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
            >
              <Check size={15} /> {pending ? 'Criando…' : 'Criar pedido'}
            </button>
          )}
        </div>
      </div>

      {/* Modais deste pedido (N-modal) — the chosen supplier's transport lanes */}
      {modalOptions.length > 0 ? (
        <div className="mb-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Modais deste pedido</span>
            {modalOptions.map((m) => (
              <label key={m.id} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={enabledModals.has(m.id)}
                  onChange={() => toggleModal(m.id)}
                  className="size-3.5 cursor-pointer accent-brand-500"
                />
                <ModalIcon m={m} />
                {m.name}
                <span className="text-xs text-muted-foreground">+{m.leadDays}d</span>
              </label>
            ))}
            <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Frequência (reposição)
              <select
                value={frequencyDays ?? 0}
                onChange={(e) => setFrequencyDays(Number(e.target.value) || null)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500"
              >
                <option value={0}>Único</option>
                <option value={30}>30 dias</option>
                <option value={60}>60 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            O modal mais lento repõe até o piso ({criteria.dohThreshold} DOH) + a frequência; os mais rápidos cobrem os vãos
            até a próxima chegada. Quantidades calculadas com o lead real do fornecedor.
          </p>
        </div>
      ) : selectedSupplier ? (
        <div className="mb-4 rounded-xl bg-alert-warning/10 p-3 text-sm text-[color:var(--color-alert-warning)]">
          Este fornecedor não tem modais cadastrados nem lead times.{' '}
          <Link href="/dashboard/fornecedores" className="underline">
            Cadastrar modais
          </Link>{' '}
          para gerar as quantidades sugeridas.
        </div>
      ) : null}

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

        {/* Modal-necessity chips (suggestão binária do motor) */}
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
              <th className="px-3 py-2.5 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-1">Quantidades por modal <InfoHint id="order-qty" /></span>
              </th>
              <th className="px-3 py-2.5 font-medium">Cobertura c/ pedido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {supplierId
                    ? 'Nenhum SKU deste fornecedor precisa de pedido no horizonte.'
                    : 'Selecione um fornecedor para ver os SKUs e as quantidades por modal.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const s = r.suggestion;
                const buyBy = slowestLead != null ? signedAddDays(s.firstBreachDate, -slowestLead) : null;
                const isIn = included.has(s.skuBase);
                const total = perSkuTotal(s.skuBase);
                return (
                  <tr key={s.skuBase} className={cn('transition-colors', isIn ? 'bg-brand-500/[0.04]' : 'hover:bg-muted/30')}>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${s.skuBase}`}
                        checked={isIn}
                        disabled={!isHead}
                        onChange={() => toggle(s.skuBase)}
                        className="mt-1 size-3.5 cursor-pointer accent-brand-500 align-middle disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Link
                        prefetch={false}
                        href={`/dashboard/estoque?sku=${encodeURIComponent(s.skuBase)}`}
                        className="font-mono text-xs text-brand-500 hover:text-brand-400"
                      >
                        {s.skuBase}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 align-top text-muted-foreground">{s.skuName}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{s.dohNow != null ? fmtInt(s.dohNow) : '—'}</td>
                    <td className="px-3 py-2 align-top tabular-nums text-xs">
                      <span className={s.isLate ? 'text-alert-error' : 'text-amber-600 dark:text-alert-warning'}>
                        {fmtDate(s.firstBreachDate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums text-xs">
                      {s.isLate ? (
                        <span className="inline-flex items-center rounded-full bg-alert-error/15 px-1.5 py-0.5 font-medium text-alert-error">
                          Atrasado
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{fmtDate(buyBy)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {enabledModalOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : isHead ? (
                        <div className="flex flex-col gap-1">
                          {enabledModalOptions.map((m) => {
                            const sug = suggestedFor(s.skuBase, m.id);
                            const val = qtyFor(s.skuBase, m.id);
                            return (
                              <div key={m.id} className="flex items-center justify-end gap-1.5">
                                <span className="mr-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <ModalIcon m={m} sm /> {m.name} <span className="opacity-60">+{m.leadDays}d</span>
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={val}
                                  onChange={(e) => setQtyOverride(s.skuBase, m.id, Number(e.target.value))}
                                  className="h-6 w-20 rounded border border-input bg-background px-1 text-right text-[11px] tabular-nums outline-none focus:border-brand-500"
                                />
                                {val !== sug && (
                                  <button
                                    onClick={() => clearQtyOverride(s.skuBase, m.id)}
                                    title={`sugerido ${fmtInt(sug)} — redefinir`}
                                    className="text-[10px] text-brand-600 hover:underline"
                                  >
                                    ↺
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          <div className="mt-0.5 border-t border-border/40 pt-0.5 text-right text-[10px] font-medium text-foreground">
                            Σ {fmtInt(total)} un.
                          </div>
                        </div>
                      ) : (
                        <div className="text-right text-xs tabular-nums">
                          {enabledModalOptions.map((m) => (
                            <div key={m.id}>
                              {m.name}: {fmtInt(qtyFor(s.skuBase, m.id))}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div
                        className="flex items-center gap-px"
                        title="Cobertura semanal com o pedido — verde: ok · amarelo: abaixo do piso · vermelho: ruptura"
                      >
                        {stripFor(r).map((c) => (
                          <span
                            key={c.weekIdx}
                            className={cn('inline-block h-4 w-1.5 rounded-[1px]', miniCellClass(c))}
                            title={`Sem ${c.weekIdx}: ${c.doh != null ? `${c.doh} DOH` : 's/ demanda'} · ${fmtInt(c.stock)} un.`}
                          />
                        ))}
                      </div>
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

// Signed date add (allows going backwards — for the buy-by = breach − lead calc).
function signedAddDays(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// Mini-strip cell color — same precedence as the big heatmap (out > low > ok), solid so a
// 6px cell reads at a glance.
function miniCellClass(c: MiniCell): string {
  if (c.isOut) return 'bg-alert-error';
  if (c.isLow) return 'bg-alert-warning';
  if (c.doh == null) return 'bg-muted';
  return 'bg-alert-success/70';
}

// Modal glyph by lead/name: courier/express → Truck, aéreo → Plane, marítimo → Ship.
function ModalIcon({ m, sm }: { m: ModalOption; sm?: boolean }) {
  const size = sm ? 9 : 13;
  const n = m.name.toLowerCase();
  if (/mar[ií]t|sea|navio|barco/.test(n)) return <Ship size={size} />;
  if (/a[eé]re|air|avi[ãa]o/.test(n)) return <Plane size={size} />;
  if (/courier|expr|moto|terrestre|rodo/.test(n)) return <Truck size={size} />;
  // Fallback by speed: fastest = truck, slowest = ship, middle = plane.
  return <Package size={size} />;
}
