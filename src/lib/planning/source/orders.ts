import 'server-only';
import { unstable_cache } from 'next/cache';
import type {
  HubId,
  OpenPurchaseOrder,
  PrepStatus,
  PurchaseOrderStatus,
  TransportModal,
} from '@/types/planning';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { toSkuBase } from '../sku';

// Open purchase orders from ClickHouse (dev.fleet_purchase_order — synced from the
// file-ingested dev.vmoto_orders, plus manual/elaborated rows; see decisions.MD #11).
// Returns [] when ClickHouse is unconfigured so the rest of the pipeline still runs
// (projections simply show no inbound).

export interface PoRow {
  id: string;
  vo: string | null;
  pedido_name: string | null;
  sku: string;
  sku_name: string | null;
  qty_ordered: number;
  order_date: string;
  eta: string | null;
  lead_time_days: number | null;
  status: string;
  modal: string | null;
  order_type: string | null;
  part_number: string | null;
  hub_id: string;
  notes: string | null;
  source: string;
  prep_status: string | null;
  created_at: string;
  updated_at: string;
}

// Cache the raw rows across requests (rows are serializable; the mapped type isn't a
// concern since we map after). Short TTL + revalidateTag('orders') on the daily sync
// and manual edits so changes show promptly. Throws on error so failures are not cached. Also the read path
// for the client-side usePurchaseOrders hook (via /api/fleet/purchase-orders) — the
// hook can no longer query ClickHouse directly from the browser.
export const fetchOrderRows = unstable_cache(
  async (): Promise<PoRow[]> => {
    const rows = await readFleetTable<PoRow>(FLEET_TABLES.purchaseOrder);
    return rows.sort((a, b) => (a.order_date < b.order_date ? 1 : a.order_date > b.order_date ? -1 : 0));
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
      pedidoName: r.pedido_name ?? null,
      skuCode: r.sku,
      skuBase: toSkuBase(r.sku),
      skuName: r.sku_name,
      qty: Number(r.qty_ordered) || 0,
      orderDate: String(r.order_date).slice(0, 10),
      eta: r.eta ? String(r.eta).slice(0, 10) : null,
      leadTimeDays: r.lead_time_days,
      modal: (r.modal as TransportModal | null) ?? null,
      status: (r.status as PurchaseOrderStatus) ?? 'ordered',
      prepStatus: (r.prep_status as PrepStatus | null) ?? null,
      hubId: (r.hub_id as HubId) ?? 'osasco',
      source: r.source ?? 'manual',
      orderType: r.order_type ?? null,
    }));
  } catch (e) {
    console.error('[fetchOpenOrders]', e instanceof Error ? e.message : e);
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
