import 'server-only';
import { chQuery } from '@/lib/clickhouse/reader';
import { createServiceSupabase } from '@/lib/supabase/service';
import { toSkuBase } from './sku';

// Daily sync: pull CURRENT purchase orders from the file-ingested ClickHouse table
// dev.vmoto_orders into Supabase fleet.purchase_order, so the app keeps reading (and
// editing) orders from one place. We keep Supabase a clean "current orders" mirror:
//   • effective ETA = eta, or (date_requested + lead_time_days) when eta is null
//   • only orders whose effective ETA is today-or-later are kept (past-ETA dropped)
//   • deduped to the latest ingest per PO line (po_number, row_number)
//   • we REPLACE only the source='clickhouse' rows — manual / n8n orders are untouched
//
// dev.vmoto_orders has no status/modal/hub, so synced rows default to
// status='ordered' (open), modal=null, hub_id='osasco'. Triggered by the daily
// Vercel cron at /api/orders/sync; records its run in fleet.job_run.

const JOB_NAME = 'orders-sync';
export const ORDERS_SYNC_SOURCE = 'clickhouse';

interface VmotoOrderRow {
  po_number: string | null;
  sku: string | null;
  item_name: string | null;
  quantity: number | string | null;
  order_date: string | null;
  eta_eff: string | null;
  lead_time_days: number | string | null;
}

// Effective ETA = eta ?? date_requested + lead_time_days. Keep only future-ETA lines,
// latest ingest per (po_number, row_number).
const ORDERS_SQL = `
SELECT po_number,
       sku,
       item_name,
       quantity,
       toString(toDate(date_requested)) AS order_date,
       toString(toDate(coalesce(eta, date_requested + toIntervalDay(lead_time_days)))) AS eta_eff,
       lead_time_days
FROM dev.vmoto_orders
WHERE sku IS NOT NULL AND sku != ''
  AND quantity > 0
  AND coalesce(eta, date_requested + toIntervalDay(lead_time_days)) >= today()
ORDER BY ingested_at DESC
LIMIT 1 BY po_number, row_number`;

export async function syncOrdersFromClickHouse(): Promise<{ inserted: number; deleted: number }> {
  const rows = await chQuery<VmotoOrderRow>(ORDERS_SQL);

  const now = new Date().toISOString();
  const mapped = rows
    .filter((r) => r.sku && r.eta_eff && r.order_date)
    .map((r) => ({
      vo: r.po_number ?? null,
      sku: String(r.sku),
      sku_base: toSkuBase(String(r.sku)),
      sku_name: r.item_name ?? null,
      qty_ordered: Number(r.quantity) || 0,
      order_date: r.order_date,
      eta: r.eta_eff,
      lead_time_days: r.lead_time_days != null ? Number(r.lead_time_days) : null,
      status: 'ordered',
      modal: null as string | null,
      hub_id: 'osasco',
      notes: null as string | null,
      source: ORDERS_SYNC_SOURCE,
      updated_at: now,
    }));

  const supabase = createServiceSupabase();

  // Guard: never wipe the synced set on an empty/failed warehouse read.
  if (mapped.length === 0) return { inserted: 0, deleted: 0 };

  // Replace the ClickHouse-sourced set. delete → insert, scoped to source='clickhouse'
  // so manual / n8n orders survive. Past-ETA rows are gone simply by not being re-added.
  const { error: delErr, count: deleted } = await supabase
    .schema('fleet')
    .from('purchase_order')
    .delete({ count: 'exact' })
    .eq('source', ORDERS_SYNC_SOURCE);
  if (delErr) throw new Error(`delete: ${delErr.message}`);

  const { error: insErr } = await supabase.schema('fleet').from('purchase_order').insert(mapped);
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  await supabase
    .schema('fleet')
    .from('job_run')
    .upsert(
      {
        job_name: JOB_NAME,
        last_run_at: now,
        detail: { inserted: mapped.length, deleted: deleted ?? 0, source: 'dev.vmoto_orders' },
      },
      { onConflict: 'job_name' },
    );

  return { inserted: mapped.length, deleted: deleted ?? 0 };
}
