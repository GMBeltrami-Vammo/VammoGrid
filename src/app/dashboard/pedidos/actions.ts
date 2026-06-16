'use server';

import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';
import type { PurchaseOrderStatus } from '@/types';

// Head-gated mutations for purchase orders. Every action verifies the Head
// session server-side before touching the service-role client.

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
    updated_at: new Date().toISOString(),
  };
}

export async function createPurchaseOrder(input: PurchaseOrderInput) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('purchase_order')
    .insert({ ...toRow(input), source: 'manual' });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updatePurchaseOrder(id: number, input: PurchaseOrderInput) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('purchase_order')
    .update(toRow(input))
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deletePurchaseOrder(id: number) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('purchase_order')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
