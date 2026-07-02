'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
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

// The single write path for the elaboration rule (sub-project B6). Called only when
// a human confirms a suggestion in Compras (never on a schedule). Creates a DRAFT
// purchase_order (prep_status='elaborado', no VO yet) — excluded from projected
// inbound until finalized ('feito'). Editable fields let the human override the
// suggested qty/modal/date before confirming.
export interface ElaboratedOrderInput {
  skuBase: string;
  skuName?: string | null;
  qty: number;
  modal: TransportModal;
  orderDate: string;
  eta?: string | null;
  leadTimeDays?: number | null;
  hubId?: string;
  notes?: string | null;
}

export async function createElaboratedOrder(
  input: ElaboratedOrderInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const changedBy = await requireHead();
    if (!input.skuBase?.trim()) return { ok: false, error: 'SKU é obrigatório.' };
    if (!(input.qty > 0)) return { ok: false, error: 'Quantidade deve ser maior que zero.' };
    const id = randomUUID();
    const now = new Date().toISOString();
    await upsertFleetRow({
      table: FLEET_TABLES.purchaseOrder,
      entityType: 'purchase_order',
      entityId: id,
      current: null,
      next: {
        id,
        vo: null,
        sku: input.skuBase.trim(),
        sku_name: input.skuName?.trim() || null,
        qty_ordered: Math.round(input.qty),
        order_date: input.orderDate,
        eta: input.eta || null,
        lead_time_days: input.leadTimeDays ?? null,
        status: 'ordered',
        modal: input.modal,
        hub_id: input.hubId ?? 'osasco',
        notes: input.notes?.trim() || null,
        source: 'elaboracao',
        prep_status: 'elaborado',
        created_at: now,
      },
      changedBy,
    });
    updateTag('orders');
    return { ok: true, id };
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
