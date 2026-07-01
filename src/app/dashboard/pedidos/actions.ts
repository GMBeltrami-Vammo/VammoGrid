'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import type { PurchaseOrderStatus } from '@/types';

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
    next: { id, ...toRow(input), source: 'manual', created_at: now },
    changedBy,
  });
  updateTag('orders'); // read-your-own-writes: refresh cached purchase_order rows now
  return { ok: true, id };
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
