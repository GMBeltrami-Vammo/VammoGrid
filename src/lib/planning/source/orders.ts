import 'server-only';
import { unstable_cache } from 'next/cache';
import type {
  HubId,
  OpenPurchaseOrder,
  PurchaseOrderStatus,
  TransportModal,
} from '@/types/planning';
import { createServerSupabase } from '@/lib/supabase/server';
import { toSkuBase } from '../sku';

// Open purchase orders from Supabase (fleet.purchase_order — fed by n8n / manual /
// xlsx import). Returns [] when Supabase is unconfigured so the rest of the
// pipeline still runs (projections simply show no inbound).

interface PoRow {
  id: number;
  vo: string | null;
  sku: string;
  sku_name: string | null;
  qty_ordered: number;
  order_date: string;
  eta: string | null;
  lead_time_days: number | null;
  status: string;
  modal: string | null;
  hub_id: string;
  source: string;
}

// Cache the raw rows across requests (rows are serializable; the mapped type isn't a
// concern since we map after). Short TTL + revalidateTag('orders') on n8n ingest so
// edits show promptly. Throws on error so failures are not cached.
const fetchOrderRows = unstable_cache(
  async (): Promise<PoRow[]> => {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .schema('fleet')
      .from('purchase_order')
      .select('*')
      .order('order_date', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PoRow[];
  },
  ['purchase-order-rows'],
  { revalidate: 120, tags: ['orders'] },
);

export async function fetchOpenOrders(): Promise<OpenPurchaseOrder[]> {
  try {
    const data = await fetchOrderRows();
    return data.map((r) => ({
      id: r.id,
      vo: r.vo,
      skuCode: r.sku,
      skuBase: toSkuBase(r.sku),
      skuName: r.sku_name,
      qty: Number(r.qty_ordered) || 0,
      orderDate: String(r.order_date).slice(0, 10),
      eta: r.eta ? String(r.eta).slice(0, 10) : null,
      leadTimeDays: r.lead_time_days,
      modal: (r.modal as TransportModal | null) ?? null,
      status: (r.status as PurchaseOrderStatus) ?? 'ordered',
      hubId: (r.hub_id as HubId) ?? 'osasco',
      source: r.source ?? 'manual',
    }));
  } catch {
    return [];
  }
}

export function ordersBySkuBase(
  orders: OpenPurchaseOrder[],
): Map<string, OpenPurchaseOrder[]> {
  const m = new Map<string, OpenPurchaseOrder[]>();
  for (const o of orders) {
    const list = m.get(o.skuBase);
    if (list) list.push(o);
    else m.set(o.skuBase, [o]);
  }
  return m;
}
