'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import { chInsert, type Row } from '@/lib/clickhouse/reader';
import { addDays } from '@/lib/planning/dates';
import type { PrepStatus, PurchaseOrderStatus } from '@/types';
import type { TransportModal } from '@/types/planning';

// Head-gated mutations for purchase orders (dev.fleet_purchase_order — formerly
// Supabase fleet.purchase_order; see decisions.MD #11). Every action verifies the
// Head session server-side, then writes through the shared audit-logging helper.

export interface PurchaseOrderInput {
  vo?: string | null;
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

async function findOrder(id: string): Promise<Row | null> {
  const rows = await readFleetTable<Row>(FLEET_TABLES.purchaseOrder);
  return rows.find((r) => r.id === id) ?? null;
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
  /** Lead time (days) for the chosen modal — drives this line's ETA. */
  leadDays: number;
}

export async function createPedido(input: {
  modal: TransportModal;
  orderDate: string;
  lines: NewPedidoLine[];
}): Promise<{ ok: boolean; vo?: string; error?: string }> {
  try {
    const changedBy = await requireHead();
    const lines = input.lines.filter((l) => l.skuBase?.trim() && l.qty > 0);
    if (lines.length === 0) return { ok: false, error: 'Selecione ao menos um SKU com quantidade.' };

    const now = new Date().toISOString();
    // Human-ish shared VO so the lines group into one pedido everywhere.
    const vo = `NP-${input.orderDate.replace(/-/g, '')}-${randomUUID().slice(0, 4).toUpperCase()}`;

    const rows: Row[] = lines.map((l) => ({
      id: randomUUID(),
      vo,
      sku: l.skuBase.trim(),
      sku_name: l.skuName?.trim() || null,
      qty_ordered: Math.round(l.qty),
      order_date: input.orderDate,
      eta: addDays(input.orderDate, Math.max(0, Math.round(l.leadDays))),
      lead_time_days: Math.max(0, Math.round(l.leadDays)),
      status: 'ordered',
      modal: input.modal,
      hub_id: 'osasco',
      notes: null,
      source: 'elaboracao',
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
        new_value: JSON.stringify({ vo, lines: rows.length, modal: input.modal }),
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
