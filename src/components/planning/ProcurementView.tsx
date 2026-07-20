'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Download, Package, Plane, Ship, Truck, CheckSquare, SlidersHorizontal, Square, Trash2 } from 'lucide-react';
import type { ElaborationRow } from '@/lib/planning/load';
import type { OrderType, SupplierModal } from '@/types';
import type { ModalPlan, OrderRules } from '@/lib/planning/elaboration';
import type { PurchaseCriteria } from '@/lib/planning/constants';
import { createPedido, type NewPedidoLine } from '@/app/dashboard/pedidos/actions';
import { modalsForSupplier, type ModalOption } from '@/lib/planning/supplierGroups';
import {
  modalCfgEntry,
  readModalCfgClient,
  setModalCfgEntry,
  writeModalCfgClient,
  type ModalCfg,
} from '@/lib/planning/modalConfig';
import { projectFromSeed, sampleMiniStrip, suggestCascadeQuantities, type MiniCell } from '@/lib/planning/miniStrip';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { DateField } from '@/components/ui/DateField';
import { InfoHint } from '@/components/planning/InfoHint';
import { cn } from '@/lib/utils';

type ModalFilter = 'all' | 'air' | 'sea';

// Weeks shown in the per-SKU mini-heatmap strip (kept fixed/compact so the column stays
// narrow regardless of the coverage-filter horizon).
const STRIP_WEEKS = 20;
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
  initialSupplierId,
  initialSkus,
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
  /** Preselected supplier (from a Projeção Global "exportar → Novo Pedido" deep link). */
  initialSupplierId?: string;
  /** Preselected SKU base codes (deep link) — restricts the initial inclusion set. */
  initialSkus?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const [modalFilter, setModalFilter] = useState<ModalFilter>('all');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [pedidoName, setPedidoName] = useState('');

  // Supplier is REQUIRED. Preselect when there's only one active supplier (today: VMoto).
  // Type (nac/int) is DERIVED from the supplier.
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.supplierId, s])), [suppliers]);
  const startSupplierId =
    (initialSupplierId && suppliers.some((s) => s.supplierId === initialSupplierId) ? initialSupplierId : '') ||
    (suppliers.length === 1 ? suppliers[0].supplierId : '');
  const [supplierId, setSupplierId] = useState(startSupplierId);
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
    () => new Set(modalsForSupplier(supplierById.get(startSupplierId) ?? null, supplierModals).map((m) => m.id)),
  );
  // Per-(sku × modalId) manual qty override; absent → the suggested qty is used.
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, Record<string, number>>>({});
  // Per-modal config (piso DOH + cadência + lead-sim) — SHARED with Projeção Global via a
  // session cookie (ephemeral, not persisted). Loaded once on mount; every edit rewrites it.
  const [cfg, setCfg] = useState<ModalCfg>({});
  useEffect(() => {
    setCfg(readModalCfgClient());
  }, []);
  const entryFor = (m: ModalOption) => modalCfgEntry(cfg, supplierId, m.name);
  const patchEntry = (m: ModalOption, patch: { piso?: number | null; cad?: number | null; lead?: number | null }) => {
    const next = setModalCfgEntry(cfg, supplierId, m.name, {
      piso: patch.piso === null ? NaN : patch.piso,
      cad: patch.cad === null ? NaN : patch.cad,
      lead: patch.lead === null ? NaN : patch.lead,
    });
    setCfg(next);
    writeModalCfgClient(next);
  };
  useEffect(() => {
    const opts = modalsForSupplier(supplierById.get(supplierId) ?? null, supplierModals);
    setEnabledModals(new Set(opts.map((m) => m.id)));
    setQtyOverrides({});
  }, [supplierId, supplierById, supplierModals]);

  const enabledModalOptions = useMemo(
    () => modalOptions.filter((m) => enabledModals.has(m.id)),
    [modalOptions, enabledModals],
  );
  // Simulated lead (cfg override, else the real supplier lead). Only affects the suggestion +
  // mini-heatmap; the created order's ETA always uses the REAL lead (m.leadDays).
  const simLead = (m: ModalOption) => {
    const e = modalCfgEntry(cfg, supplierId, m.name);
    return e.lead && e.lead > 0 ? e.lead : m.leadDays;
  };
  // The slowest ENABLED lane — MUST match suggestCascadeQuantities' own choice (it sorts by
  // ROUNDED sim lead, stable, and treats the LAST as the sustaining lane). On a lead tie the
  // last one wins here too, so the cadência input sits on the exact lane the engine applies
  // cadência to — otherwise the cadence volume would silently vanish. Only it carries a cadência
  // ("uma vez só" for the others); also drives the buy-by column.
  const slowestModalId = useMemo(() => {
    if (enabledModalOptions.length === 0) return null;
    const sorted = [...enabledModalOptions].sort((a, b) => Math.round(simLead(a)) - Math.round(simLead(b)));
    return sorted[sorted.length - 1].id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledModalOptions, cfg, supplierId]);
  const slowestLead = enabledModalOptions.find((m) => m.id === slowestModalId)?.leadDays ?? selectedSupplier?.leadTimeSeaDays ?? null;

  // The plans the qty engine runs: each lane holds ITS piso (DOH mín) at its SIM lead. Only the
  // slowest lane carries a cadência (order-up-to piso+cadência); the faster lanes bridge the
  // gap from their arrival to the next lane holding their (lower) floor — the layered cascade.
  const plans = useMemo<ModalPlan[]>(
    () =>
      enabledModalOptions.map((m) => {
        const e = modalCfgEntry(cfg, supplierId, m.name);
        const lead = e.lead && e.lead > 0 ? e.lead : m.leadDays;
        const isSlow = m.id === slowestModalId;
        return {
          modal: { ...m, leadDays: lead }, // sim lead — planning only, not the order ETA
          minDoh: e.piso && e.piso > 0 ? e.piso : criteria.dohThreshold,
          cadenceDays: isSlow ? (e.cad && e.cad > 0 ? e.cad : 30) : 0,
          enabled: true,
        };
      }),
    [enabledModalOptions, criteria.dohThreshold, cfg, supplierId, slowestModalId],
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
  const [createdVos, setCreatedVos] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // When a supplier is chosen, the builder shows ONLY that supplier's linked SKUs.
  const supplierSkuSet = useMemo(
    () => (supplierId ? new Set(skusBySupplier[supplierId] ?? []) : null),
    [supplierId, skusBySupplier],
  );

  // Suggested qty per (sku → modalId) from the N-modal CASCADE engine. It re-projects each
  // SKU's seed after every lane (faster lanes bridge holding their piso to the next arrival;
  // the slowest sustains order-up-to piso+cadência) so the floored/lost-sales walk is honoured.
  const suggestedByModal = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    if (plans.length === 0) return out;
    for (const r of rows) {
      const qs = suggestCascadeQuantities({ seed: r.miniSeed, plans, today });
      out.set(r.suggestion.skuBase, new Map(qs.map((q) => [q.modalId, q.qty])));
    }
    return out;
  }, [rows, plans, today]);

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

  // Per-SKU "com pedido" coverage strip: baseline + this row's injected modal arrivals (at
  // the SIM lead, so the strip reflects the simulated timing).
  const stripFor = (r: ElaborationRow): MiniCell[] => {
    const sku = r.suggestion.skuBase;
    const injected = enabledModalOptions
      .map((m) => ({ offset: simLead(m), qty: qtyFor(sku, m.id) }))
      .filter((x) => x.qty > 0);
    const proj = projectFromSeed(r.miniSeed, injected, today);
    return sampleMiniStrip(proj, STRIP_OFFSETS, criteria.dohThreshold);
  };

  // Which strip cell (week) a day-offset lands in. Week columns are anchored at TODAY (col 0),
  // 7-day steps — NOT a calendar/Sunday week. We round to the NEAREST week so an arrival lands in
  // the week it actually falls in (a 45-day lead → week 6, ≈6.4 weeks — not ceil'd up to 7/8).
  const weekOf = (offset: number) => (offset <= 0 ? 0 : Math.min(STRIP_WEEKS - 1, Math.round(offset / 7)));

  // Per-week arrival markers for the mini-heatmap: REGISTERED orders (from r.openPos) above the
  // bars, and the SIMULATED order being built below — each with the DOH it ADDS (qty ÷ consumo/dia).
  const stripArrivals = (r: ElaborationRow): { reg: RegArrival[][]; sim: SimArrival[][] } => {
    const sku = r.suggestion.skuBase;
    const rate = r.suggestion.dailyDemand;
    const dohOf = (qty: number) => (rate > 0 ? Math.round(qty / rate) : 0);
    const reg: RegArrival[][] = Array.from({ length: STRIP_WEEKS }, () => []);
    for (const p of r.openPos)
      reg[weekOf(p.dayOffset)].push({ name: p.name || p.vo || 'pedido', qty: p.qty, modal: p.modal, doh: dohOf(p.qty) });
    const sim: SimArrival[][] = Array.from({ length: STRIP_WEEKS }, () => []);
    for (const m of enabledModalOptions) {
      const qty = qtyFor(sku, m.id);
      if (qty > 0) sim[weekOf(simLead(m))].push({ modal: m.name, qty, doh: dohOf(qty) });
    }
    return { reg, sim };
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const s = r.suggestion;
      if (supplierSkuSet && !supplierSkuSet.has(s.skuBase)) return false;
      if (q && !s.skuBase.toLowerCase().includes(q) && !(s.skuName ?? '').toLowerCase().includes(q)) return false;
      if (modalFilter !== 'all' && s.suggestedModal !== modalFilter) return false;
      return true;
    });
  }, [rows, search, modalFilter, supplierSkuSet]);

  // Default inclusion: every row, unless the deep link named a specific SKU set (then only
  // those, intersected with what actually needs an order).
  const [included, setIncluded] = useState<Set<string>>(() => {
    if (initialSkus && initialSkus.length > 0) {
      const want = new Set(initialSkus);
      return new Set(rows.map((r) => r.suggestion.skuBase).filter((b) => want.has(b)));
    }
    return new Set(rows.map((r) => r.suggestion.skuBase));
  });

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

  // Frozen elaboration basis (item 8) — records the criteria + rules + the per-modal plan
  // (piso + cadência each), so previsão×realizado can reconstruct the layered floors later.
  const auditObj = {
    forecastAsOf,
    criteria: rules?.seaFloorDoh ? { ...criteria, dohThreshold: rules.seaFloorDoh } : criteria,
    rules: rules ?? undefined,
    modalPlan: plans.map((p) => ({
      id: p.modal.id,
      name: p.modal.name,
      leadDays: p.modal.leadDays,
      minDoh: p.minDoh,
      cadenceDays: p.cadenceDays,
    })),
  };

  // Units the given modal would order across the selected SKUs (drives the button label + gate).
  const unitsForModal = (m: ModalOption) =>
    selectedRows.reduce((s, r) => s + qtyFor(r.suggestion.skuBase, m.id), 0);

  // "Criar pedido (modal)" → ONE pedido (VO) for a SINGLE modal: its lines across the
  // selected SKUs (create one modal at a time).
  const criarPedidoModal = (m: ModalOption) => {
    setError(null);
    setCreatedVos([]);
    if (!selectedSupplier) {
      setError('Selecione um fornecedor para o pedido.');
      return;
    }
    const lines: NewPedidoLine[] = [];
    for (const r of selectedRows) {
      const qty = qtyFor(r.suggestion.skuBase, m.id);
      if (qty <= 0) continue;
      lines.push({
        skuBase: r.suggestion.skuBase,
        skuName: r.suggestion.skuName,
        qty,
        leadDays: m.leadDays,
        modal: m.name,
        suggestedQty: suggestedFor(r.suggestion.skuBase, m.id),
        suggestedModal: m.name,
      });
    }
    if (lines.length === 0) {
      setError(`Nenhum SKU com quantidade maior que zero no modal ${m.name}.`);
      return;
    }
    const sup = selectedSupplier;
    startTransition(async () => {
      const res = await createPedido({
        modal: m.name,
        orderDate,
        pedidoName: pedidoName ? `${pedidoName} · ${m.name}` : m.name,
        orderType,
        supplierId: sup.supplierId,
        supplierName: sup.name,
        lines,
        audit: auditObj,
      });
      if (res.ok) {
        setCreatedVos(res.vo ? [res.vo] : []);
        router.refresh();
      } else {
        setError(res.error ?? `Erro ao criar pedido ${m.name}.`);
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCount}</span> SKUs · {fmtInt(selectedUnits)} un.
          </span>
          {/* One "Criar pedido (modal)" button per enabled modal — creates that modal's pedido only. */}
          {isHead &&
            enabledModalOptions.map((m) => {
              const units = unitsForModal(m);
              return (
                <button
                  key={m.id}
                  onClick={() => criarPedidoModal(m)}
                  disabled={pending || units <= 0 || !supplierId}
                  title={!supplierId ? 'Selecione um fornecedor' : `Cria só o pedido ${m.name}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
                >
                  <ModalIcon m={m} sm /> Criar ({m.name}) · {fmtInt(units)} un.
                </button>
              );
            })}
        </div>
      </div>

      {/* Modais deste pedido (N-modal) — cada modal com seu piso (DOH mín) + cadência */}
      {modalOptions.length > 0 ? (
        <div className="mb-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Modais deste pedido</span>
          <div className="mt-2 space-y-1.5">
            {modalOptions.map((m) => {
              const on = enabledModals.has(m.id);
              const e = entryFor(m);
              const isSlow = m.id === slowestModalId;
              const numOr = (v: string) => (v.trim() === '' ? null : Number(v));
              return (
                <div key={m.id} className={cn('flex flex-wrap items-center gap-2 text-sm', !on && 'opacity-50')}>
                  <label className="inline-flex w-40 cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleModal(m.id)}
                      className="size-3.5 cursor-pointer accent-brand-500"
                    />
                    <ModalIcon m={m} />
                    {m.name}
                    <span className="text-xs text-muted-foreground">+{m.leadDays}d</span>
                  </label>
                  <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    Lead sim.
                    <input
                      type="number"
                      min={1}
                      value={e.lead ?? ''}
                      disabled={!on}
                      onChange={(ev) => patchEntry(m, { lead: numOr(ev.target.value) })}
                      placeholder={String(m.leadDays)}
                      title="Lead hipotético (dias) — só a simulação/sugestão; a ETA do pedido usa o lead real"
                      className="h-7 w-16 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    Piso (DOH)
                    <input
                      type="number"
                      min={1}
                      value={e.piso ?? ''}
                      disabled={!on}
                      onChange={(ev) => patchEntry(m, { piso: numOr(ev.target.value) })}
                      placeholder={String(criteria.dohThreshold)}
                      title="Piso de cobertura (DOH mín) que este modal segura"
                      className="h-7 w-16 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                    />
                  </label>
                  {isSlow ? (
                    <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      Cadência (dias)
                      <input
                        type="number"
                        min={1}
                        value={e.cad ?? ''}
                        disabled={!on}
                        onChange={(ev) => patchEntry(m, { cad: numOr(ev.target.value) })}
                        placeholder="30"
                        title="Periodicidade de reposição do modal mais lento — cobertura extra além do piso"
                        className="h-7 w-16 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                      />
                    </label>
                  ) : (
                    <span className="text-[10px] italic text-muted-foreground/70">uma vez só</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Pisos em camadas (ex.: Courier 15 · Aéreo 30 · Marítimo 75 = a meta): o modal mais lento faz o volume até
            piso + cadência; os mais rápidos cobrem o vão só uma vez, segurando os pisos menores. Lead sim. muda só a
            sugestão/heatmap (a ETA do pedido usa o lead real). Cada modal vira <b>um pedido separado</b>.
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
      {createdVos.length > 0 && (
        <p className="mb-3 rounded-md bg-alert-success/10 px-3 py-2 text-sm text-alert-success">
          {createdVos.length === 1 ? 'Pedido criado.' : `${createdVos.length} pedidos criados (um por modal).`}{' '}
          {createdVos.map((vo, i) => (
            <span key={vo}>
              {i > 0 && ' · '}
              <Link href={`/dashboard/pedidos/${encodeURIComponent(vo)}`} className="font-medium hover:underline">
                Ver {vo} →
              </Link>
            </span>
          ))}
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
              <th className="px-3 py-2.5 font-medium">Pedidos</th>
              <th className="px-3 py-2.5 font-medium">Cobertura c/ pedido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
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
                      <OrdersCell
                        reg={r.openPos.map((p) => ({
                          vo: p.vo,
                          modal: p.modal,
                          qty: p.qty,
                          eta: offsetToDate(p.dayOffset),
                        }))}
                        neu={enabledModalOptions
                          .filter((m) => qtyFor(s.skuBase, m.id) > 0)
                          .map((m) => ({
                            modal: m.name,
                            qty: qtyFor(s.skuBase, m.id),
                            eta: signedAddDays(orderDate, m.leadDays),
                          }))}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <CoverageStrip cells={stripFor(r)} {...stripArrivals(r)} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Cobertura c/ pedido: o número em cada quadradinho é o DOH da semana.{' '}
        <span className="font-bold text-orange-500 dark:text-orange-400">▼ +N</span> = pedido JÁ REGISTRADO chegando (laranja, N = DOH que ele adiciona);{' '}
        <span className="font-bold text-sky-500 dark:text-sky-400">▲ +N</span> = novo pedido em construção (azul). Mesma cor na coluna Pedidos; passe o mouse para pedido/modal + quantidade.
      </p>
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

// Mini-strip cell color + readable text — same precedence as the big heatmap (out > low > ok).
// The DOH sits INSIDE the tile, so each state needs a text color that reads on its background;
// white on the amber "low" tile was unreadable → black there.
function miniCellClass(c: MiniCell): string {
  if (c.isOut) return 'bg-alert-error text-white';
  if (c.isLow) return 'bg-alert-warning text-neutral-900'; // black on amber — legible
  if (c.doh == null) return 'bg-muted text-muted-foreground';
  return 'bg-alert-success/80 text-white';
}

interface RegArrival {
  name: string;
  qty: number;
  modal: string | null;
  /** DOH this arrival adds (qty ÷ consumo/dia). */
  doh: number;
}
interface SimArrival {
  modal: string;
  qty: number;
  doh: number;
}

// The "Cobertura c/ pedido" mini-heatmap: one column per week (anchored at today). The coverage
// cell shows its DOH inside; a chevron ABOVE (orange) marks a REGISTERED order arriving and BELOW
// (blue) the NEW order being built — each labeled with the DOH it ADDS (qty ÷ consumo/dia), no
// hover needed. Same orange/blue coding as the Pedidos column. Hover for pedido name/modal + qty.
function CoverageStrip({ cells, reg, sim }: { cells: MiniCell[]; reg: RegArrival[][]; sim: SimArrival[][] }) {
  return (
    <div className="flex gap-0.5">
      {cells.map((c, i) => {
        const ra = reg[i] ?? [];
        const sa = sim[i] ?? [];
        const regDoh = ra.reduce((s, x) => s + x.doh, 0);
        const simDoh = sa.reduce((s, x) => s + x.doh, 0);
        return (
          <div key={i} className="flex w-8 shrink-0 flex-col items-center gap-0.5">
            <span
              className="flex h-4 items-center justify-center gap-px text-[10px] font-bold leading-none text-orange-500 dark:text-orange-400"
              title={
                ra.length
                  ? ra
                      .map((x) => `Pedido ${x.name}: +${fmtInt(x.qty)} un (+${x.doh} DOH) · Sem ${i}${x.modal ? ` · ${x.modal}` : ''}`)
                      .join(' · ')
                  : undefined
              }
            >
              {ra.length ? (
                <>
                  <ChevronDown size={11} strokeWidth={3} />+{regDoh}
                </>
              ) : null}
            </span>
            <span
              className={cn(
                'flex h-6 w-8 items-center justify-center rounded-[2px] text-[10px] font-semibold tabular-nums',
                miniCellClass(c),
              )}
              title={`Sem ${c.weekIdx}: ${c.doh != null ? `${c.doh} DOH` : 's/ demanda'} · ${fmtInt(c.stock)} un.`}
            >
              {c.doh != null ? c.doh : '—'}
            </span>
            <span
              className="flex h-4 items-center justify-center gap-px text-[10px] font-bold leading-none text-sky-500 dark:text-sky-400"
              title={sa.length ? sa.map((x) => `Novo pedido ${x.modal}: +${fmtInt(x.qty)} un (+${x.doh} DOH) · Sem ${i}`).join(' · ') : undefined}
            >
              {sa.length ? (
                <>
                  <ChevronUp size={11} strokeWidth={3} />+{simDoh}
                </>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The "Pedidos" column: registered orders (orange, already placed — links to the pedido) and
// the new order being built (blue), each with modal · ETA (dd-mm-YYYY) · quantidade.
interface RegOrder {
  vo: string | null;
  modal: string | null;
  qty: number;
  eta: string | null;
}
interface NewOrderLine {
  modal: string;
  qty: number;
  eta: string | null;
}

function OrdersCell({ reg, neu }: { reg: RegOrder[]; neu: NewOrderLine[] }) {
  if (reg.length === 0 && neu.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {reg.map((o, i) => {
        const chip = (
          <span className="inline-flex items-center gap-1 rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 ring-1 ring-orange-500/30 dark:text-orange-400">
            <ChevronDown size={10} strokeWidth={3} />
            {o.modal ? `${o.modal} · ` : ''}
            {fmtDate(o.eta)} · {fmtInt(o.qty)} un.
          </span>
        );
        return o.vo ? (
          <Link key={`r${i}`} prefetch={false} href={`/dashboard/pedidos/${encodeURIComponent(o.vo)}`} className="hover:opacity-80">
            {chip}
          </Link>
        ) : (
          <span key={`r${i}`}>{chip}</span>
        );
      })}
      {neu.map((o, i) => (
        <span
          key={`n${i}`}
          className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 ring-1 ring-sky-500/30 dark:text-sky-400"
        >
          <ChevronUp size={10} strokeWidth={3} />
          {o.modal} · {fmtDate(o.eta)} · {fmtInt(o.qty)} un.
        </span>
      ))}
    </div>
  );
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
