'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import { chInsert, type Row } from '@/lib/clickhouse/reader';
import { addDays } from '@/lib/planning/dates';
import type { OrderType, PrepStatus, PurchaseOrderStatus } from '@/types';
import type { TransportModal } from '@/types/planning';

// Head-gated mutations for purchase orders (dev.fleet_purchase_order — formerly
// Supabase fleet.purchase_order; see decisions.MD #11). Every action verifies the
// Head session server-side, then writes through the shared audit-logging helper.

export interface PurchaseOrderInput {
  vo?: string | null;
  pedidoName?: string | null;
  orderType?: OrderType | null;
  sku: string;
  skuName?: string | null;
  qtyOrdered: number;
  orderDate: string;
  eta?: string | null;
  leadTimeDays?: number | null;
  status?: PurchaseOrderStatus;
  modal?: string | null;
  hubId?: string;
  notes?: string | null;
}

function toRow(input: PurchaseOrderInput) {
  return {
    vo: input.vo?.trim() || null,
    pedido_name: input.pedidoName?.trim() || null,
    order_type: input.orderType ?? null,
    sku: input.sku.trim(),
    sku_name: input.skuName?.trim() || null,
    qty_ordered: input.qtyOrdered,
    order_date: input.orderDate,
    eta: input.eta || null,
    lead_time_days: input.leadTimeDays ?? null,
    status: input.status ?? 'ordered',
    modal: input.modal || null,
    hub_id: input.hubId ?? 'osasco',
    notes: input.notes?.trim() || null,
  };
}

function findOrder(id: string): Promise<Row | null> {
  return readFleetRow<Row>(FLEET_TABLES.purchaseOrder, { id });
}

export async function createPurchaseOrder(input: PurchaseOrderInput) {
  const changedBy = await requireHead();
  const id = randomUUID();
  const now = new Date().toISOString();
  await upsertFleetRow({
    table: FLEET_TABLES.purchaseOrder,
    entityType: 'purchase_order',
    entityId: id,
    current: null,
    next: { id, ...toRow(input), source: 'manual', prep_status: null, created_at: now },
    changedBy,
  });
  updateTag('orders'); // read-your-own-writes: refresh cached purchase_order rows now
  return { ok: true, id };
}

// Create ONE pedido (a single VO with N SKU lines) from the "Novo Pedido" builder in
// Compras. The modal is a global choice for the whole order; each line's ETA is
// order_date + that SKU's lead for the chosen modal. Lands as a draft
// (prep_status='elaborado'), grouped by a generated VO — indistinguishable from the
// pedidos synced/entered elsewhere. Called only on the explicit "Criar pedido" click.
export interface NewPedidoLine {
  skuBase: string;
  skuName?: string | null;
  qty: number;
  /** Lead time (days) for this line's modal — drives its ETA. */
  leadDays: number;
  /** Per-line transport modal (N-modal builder: courier/aéreo/marítimo…). Falls back to
   *  the order-wide `modal` when absent (import flow). Free string — the engine is
   *  modal-agnostic (timing comes from leadDays), so any label is valid. */
  modal?: string | null;
  /** Supplier's part number for this item (Notas P3); recorded on the line. */
  partNumber?: string | null;
  /** Frozen elaboration basis for this line (review item 8). */
  suggestedQty?: number;
  suggestedModal?: string | null;
}

/** Order-wide elaboration context frozen into every line at "Criar pedido" (item 8). */
export interface PedidoAudit {
  /** asOfDate of the demand forecast the suggestions were computed from. */
  forecastAsOf: string;
  /** The criteria in effect (global Admin, already merged with per-pedido rules). */
  criteria: unknown;
  /** Per-pedido rule overrides applied, if any. */
  rules?: unknown;
}

export async function createPedido(input: {
  /** Order-wide modal (import flow). The N-modal builder sets `modal` per LINE instead;
   *  each line falls back to this when its own modal is absent. */
  modal?: TransportModal | string | null;
  orderDate: string;
  pedidoName?: string | null;
  orderType?: OrderType | null;
  lines: NewPedidoLine[];
  /** When present, freezes the elaboration basis into each line (item 8). */
  audit?: PedidoAudit;
  /** Row provenance: 'elaboracao' (builder, default), 'import' (.xlsx upload). Distinct
   *  from 'clickhouse' so the daily sync's replace-by-source never touches these. */
  source?: string;
  /** Fornecedor vinculado ao pedido (review 4b). */
  supplierId?: string | null;
  supplierName?: string | null;
}): Promise<{ ok: boolean; vo?: string; error?: string }> {
  try {
    const changedBy = await requireHead();
    const lines = input.lines.filter((l) => l.skuBase?.trim() && l.qty > 0);
    if (lines.length === 0) return { ok: false, error: 'Selecione ao menos um SKU com quantidade.' };

    const now = new Date().toISOString();
    // Human-ish shared VO so the lines group into one pedido everywhere.
    const vo = `NP-${input.orderDate.replace(/-/g, '')}-${randomUUID().slice(0, 4).toUpperCase()}`;
    // A pedido can span modais (one line each) — summarize them for the creation audit.
    const lineModals = [...new Set(lines.map((l) => l.modal).filter(Boolean) as string[])];
    const modalSummary = input.modal ?? (lineModals.length > 0 ? lineModals.join('+') : null);

    const rows: Row[] = lines.map((l) => ({
      id: randomUUID(),
      vo,
      pedido_name: input.pedidoName?.trim() || null,
      order_type: input.orderType ?? null,
      supplier_id: input.supplierId ?? null,
      supplier_name: input.supplierName?.trim() || null,
      elaboration_snapshot: input.audit
        ? JSON.stringify({
            ...input.audit,
            suggestedQty: l.suggestedQty ?? null,
            suggestedModal: l.suggestedModal ?? null,
            chosenQty: Math.round(l.qty),
          })
        : null,
      sku: l.skuBase.trim(),
      sku_name: l.skuName?.trim() || null,
      qty_ordered: Math.round(l.qty),
      order_date: input.orderDate,
      eta: addDays(input.orderDate, Math.max(0, Math.round(l.leadDays))),
      lead_time_days: Math.max(0, Math.round(l.leadDays)),
      status: 'ordered',
      modal: l.modal ?? input.modal ?? null,
      part_number: l.partNumber?.trim() || null,
      hub_id: 'osasco',
      notes: null,
      source: input.source ?? 'elaboracao',
      prep_status: 'elaborado',
      created_at: now,
      updated_at: now,
      is_deleted: false,
    }));

    // Bulk insert (machine-created, one pedido) — audited as a single creation event
    // rather than a per-field diff per line.
    await chInsert(FLEET_TABLES.purchaseOrder, rows);
    await chInsert(FLEET_TABLES.auditLog, [
      {
        id: randomUUID(),
        entity_type: 'purchase_order',
        entity_id: vo,
        field: 'created',
        old_value: null,
        new_value: JSON.stringify({ vo, lines: rows.length, modal: modalSummary }),
        changed_by: changedBy,
        changed_at: now,
      },
    ]);

    updateTag('orders');
    return { ok: true, vo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

// Pedido-level edit (request #1): status / ETA / order date live at the PEDIDO
// level, so a header edit applies to EVERY line sharing the VO at once. Audit-logged
// per line.
export interface PedidoHeaderPatch {
  status?: PurchaseOrderStatus;
  eta?: string | null;
  orderDate?: string;
  pedidoName?: string | null;
  orderType?: OrderType | null;
}

export async function updatePedidoHeader(
  ids: string[],
  patch: PedidoHeaderPatch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const changedBy = await requireHead();
    if (ids.length === 0) return { ok: true };
    const rows = await readFleetTable<Row>(FLEET_TABLES.purchaseOrder);
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const id of ids) {
      const current = byId.get(id);
      if (!current) continue;
      const next: Row = { ...current };
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.eta !== undefined) next.eta = patch.eta || null;
      if (patch.orderDate !== undefined) next.order_date = patch.orderDate;
      if (patch.pedidoName !== undefined) next.pedido_name = patch.pedidoName?.trim() || null;
      if (patch.orderType !== undefined) next.order_type = patch.orderType ?? null;
      await upsertFleetRow({
        table: FLEET_TABLES.purchaseOrder,
        entityType: 'purchase_order',
        entityId: id,
        current,
        next,
        changedBy,
      });
    }
    updateTag('orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

// Line-level edit (request #1): only the SKU / item name / quantity of a single line;
// status/ETA/date are the pedido's, not the line's.
export async function updateOrderLine(
  id: string,
  line: { sku: string; skuName?: string | null; qtyOrdered: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const changedBy = await requireHead();
    if (!line.sku?.trim()) return { ok: false, error: 'SKU é obrigatório.' };
    const current = await findOrder(id);
    if (!current) return { ok: false, error: `Linha ${id} não encontrada.` };
    await upsertFleetRow({
      table: FLEET_TABLES.purchaseOrder,
      entityType: 'purchase_order',
      entityId: id,
      current,
      next: {
        ...current,
        sku: line.sku.trim(),
        sku_name: line.skuName?.trim() || null,
        qty_ordered: Math.max(0, Math.round(line.qtyOrdered)),
      },
      changedBy,
    });
    updateTag('orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function updatePurchaseOrder(id: string, input: PurchaseOrderInput) {
  const changedBy = await requireHead();
  const current = await findOrder(id);
  if (!current) throw new Error(`Pedido ${id} não encontrado.`);
  await upsertFleetRow({
    table: FLEET_TABLES.purchaseOrder,
    entityType: 'purchase_order',
    entityId: id,
    current,
    next: { ...current, ...toRow(input) },
    changedBy,
  });
  updateTag('orders');
  return { ok: true };
}

// Advance a pedido's preparation stage (elaborado → enviado → feito) — D1. A draft
// (elaborado/enviado) is excluded from projected inbound; 'feito' finalizes it into a
// real placed order that counts. Passing null reverts to a normal (non-draft) order.
export async function setPrepStatus(
  id: string,
  prepStatus: PrepStatus | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const changedBy = await requireHead();
    const current = await findOrder(id);
    if (!current) return { ok: false, error: `Pedido ${id} não encontrado.` };
    await upsertFleetRow({
      table: FLEET_TABLES.purchaseOrder,
      entityType: 'purchase_order',
      entityId: id,
      current,
      next: { ...current, prep_status: prepStatus },
      changedBy,
    });
    updateTag('orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deletePurchaseOrder(id: string) {
  const changedBy = await requireHead();
  const current = await findOrder(id);
  if (!current) throw new Error(`Pedido ${id} não encontrado.`);
  await softDeleteFleetRow({
    table: FLEET_TABLES.purchaseOrder,
    entityType: 'purchase_order',
    entityId: id,
    current,
    changedBy,
  });
  updateTag('orders');
  return { ok: true };
}

// Delete a WHOLE pedido (every line sharing the VO) at once — the pedido-level
// counterpart of deletePurchaseOrder (which removes a single line). Soft-deletes each
// line so the audit trail is preserved. Ids are resolved by the caller (the grouped VO).
export async function deletePedido(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const changedBy = await requireHead();
    if (ids.length === 0) return { ok: true };
    const rows = await readFleetTable<Row>(FLEET_TABLES.purchaseOrder);
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const id of ids) {
      const current = byId.get(id);
      if (!current) continue;
      await softDeleteFleetRow({
        table: FLEET_TABLES.purchaseOrder,
        entityType: 'purchase_order',
        entityId: id,
        current,
        changedBy,
      });
    }
    updateTag('orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
