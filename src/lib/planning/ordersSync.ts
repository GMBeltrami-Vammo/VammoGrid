import 'server-only';
import { chQuery } from '@/lib/clickhouse/reader';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fetchSkuPolicies } from './source/policies';
import { effectiveLeadDays } from './policy';
import { toSkuBase } from './sku';
import { addDays, todayUtc } from './dates';

// Daily sync: pull CURRENT purchase orders from the file-ingested ClickHouse table
// dev.vmoto_orders into Supabase fleet.purchase_order, so the app keeps reading (and
// editing) orders from one place. We keep Supabase a clean "current orders" mirror:
//   • ETA = order_date (date_requested) + the SKU's EFFECTIVE LEAD TIME from Supabase
//     (sku_policy override → national seed → 110d default), NOT the upstream feed's
//     eta/lead_time — so the planning lead times drive arrival dates everywhere.
//   • only orders whose computed ETA is today-or-later are kept (past-ETA dropped)
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
}

// Every current PO line (latest ingest per po_number/row_number). ETA is NOT taken
// from the feed — it's computed in TS from order_date + the Supabase lead time, then
// past-ETA lines are filtered out there too.
const ORDERS_SQL = `
SELECT po_number,
       sku,
       item_name,
       quantity,
       toString(toDate(date_requested)) AS order_date
FROM dev.vmoto_orders
WHERE sku LIKE 'VM%'
  AND quantity > 0
  AND date_requested IS NOT NULL
ORDER BY ingested_at DESC
LIMIT 1 BY po_number, row_number`;

export async function syncOrdersFromClickHouse(): Promise<{ inserted: number; deleted: number }> {
  // Orders from the feed + the per-SKU lead-time policy from Supabase (cached).
  const [rows, overrides] = await Promise.all([
    chQuery<VmotoOrderRow>(ORDERS_SQL),
    fetchSkuPolicies(),
  ]);

  const today = todayUtc();
  const now = new Date().toISOString();

  const mapped = rows
    .filter((r) => r.sku && r.order_date)
    .map((r) => {
      const skuBase = toSkuBase(String(r.sku));
      // ETA = order date + the SKU's effective planning lead time (Supabase/seed/default).
      const leadDays = effectiveLeadDays(skuBase, overrides.get(skuBase));
      const eta = addDays(String(r.order_date), leadDays);
      return {
        vo: r.po_number ?? null,
        sku: String(r.sku),
        sku_name: r.item_name ?? null,
        qty_ordered: Number(r.quantity) || 0,
        order_date: String(r.order_date),
        eta,
        lead_time_days: leadDays,
        status: 'ordered',
        modal: null as string | null,
        hub_id: 'osasco',
        notes: null as string | null,
        source: ORDERS_SYNC_SOURCE,
        updated_at: now,
      };
    })
    // Keep only orders whose computed ETA is today-or-later (drop past-ETA → clean).
    .filter((o) => o.eta >= today);

  const supabase = createServiceSupabase();

  // Guard: never wipe the synced set on an empty/failed warehouse read. (Use the raw
  // row count — if the feed genuinely has no current orders, mapped can be empty and
  // we still clear the stale clickhouse set below.)
  if (rows.length === 0) return { inserted: 0, deleted: 0 };

  // Replace the ClickHouse-sourced set. delete → insert, scoped to source='clickhouse'
  // so manual / n8n orders survive. Past-ETA rows are gone simply by not being re-added.
  const { error: delErr, count: deleted } = await supabase
    .schema('fleet')
    .from('purchase_order')
    .delete({ count: 'exact' })
    .eq('source', ORDERS_SYNC_SOURCE);
  if (delErr) throw new Error(`delete: ${delErr.message}`);

  if (mapped.length > 0) {
    const { error: insErr } = await supabase.schema('fleet').from('purchase_order').insert(mapped);
    if (insErr) throw new Error(`insert: ${insErr.message}`);
  }

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
