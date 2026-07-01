import 'server-only';
import { randomUUID } from 'crypto';
import { chInsert, chQuery, type Row } from '@/lib/clickhouse/reader';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { fetchSkuPolicies } from './source/policies';
import { effectiveLeadDays } from './policy';
import { toSkuBase } from './sku';
import { addDays, todayUtc } from './dates';

// Daily sync: pull CURRENT purchase orders from the file-ingested ClickHouse table
// dev.vmoto_orders into dev.fleet_purchase_order (formerly Supabase fleet.purchase_order —
// see decisions.MD #11), so the app keeps reading (and editing) orders from one place.
// We keep it a clean "current orders" mirror:
//   • ETA = order_date (date_requested) + the SKU's EFFECTIVE LEAD TIME (sku_policy
//     override → national seed → 110d default), NOT the upstream feed's eta/lead_time —
//     so the planning lead times drive arrival dates everywhere.
//   • only orders whose computed ETA is today-or-later are kept (past-ETA dropped)
//   • deduped to the latest ingest per PO line (po_number, row_number)
//   • we REPLACE only the source='clickhouse' rows — manual / n8n orders are untouched
//     (soft-delete: insert a new is_deleted=true version of each, ReplacingMergeTree
//     keeps only the newest per id)
//
// This is a system-generated bulk sync, not a human edit, so it does NOT go through
// the per-field audit log (that would flood it daily) — its own summary already
// lands in fleet_job_run.detail.
//
// dev.vmoto_orders has no status/modal/hub, so synced rows default to
// status='ordered' (open), modal=null, hub_id='osasco'. Triggered by the daily
// Vercel cron at /api/orders/sync; records its run in dev.fleet_job_run.

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
// from the feed — it's computed in TS from order_date + the effective lead time
// (dev.fleet_sku_policy), then past-ETA lines are filtered out there too.
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
  // Orders from the feed + the per-SKU lead-time policy from ClickHouse (cached).
  const [rows, overrides] = await Promise.all([
    chQuery<VmotoOrderRow>(ORDERS_SQL),
    fetchSkuPolicies(),
  ]);

  const today = todayUtc();
  const now = new Date().toISOString();

  const mapped: Row[] = rows
    .filter((r) => r.sku && r.order_date)
    .map((r) => {
      const skuBase = toSkuBase(String(r.sku));
      // ETA = order date + the SKU's effective planning lead time (policy/seed/default).
      const leadDays = effectiveLeadDays(skuBase, overrides.get(skuBase));
      const eta = addDays(String(r.order_date), leadDays);
      return {
        id: randomUUID(),
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
        created_at: now,
        updated_at: now,
        is_deleted: false,
        __eta: eta, // carried through the filter below, stripped before insert
      };
    })
    // Keep only orders whose computed ETA is today-or-later (drop past-ETA → clean).
    .filter((o) => (o.__eta as string) >= today)
    .map(({ __eta, ...o }) => o);

  // Guard: never wipe the synced set on an empty/failed warehouse read.
  if (rows.length === 0) return { inserted: 0, deleted: 0 };

  // Replace the ClickHouse-sourced set: soft-delete existing source='clickhouse' rows
  // (insert an is_deleted=true version of each — ReplacingMergeTree keeps the newest),
  // then insert the fresh set. Manual / n8n orders (other `source` values) are untouched.
  const existing = await readFleetTable<Row>(FLEET_TABLES.purchaseOrder);
  const toRetire = existing.filter((r) => r.source === ORDERS_SYNC_SOURCE);
  if (toRetire.length > 0) {
    await chInsert(
      FLEET_TABLES.purchaseOrder,
      toRetire.map((r) => ({ ...r, updated_at: now, is_deleted: true })),
    );
  }
  if (mapped.length > 0) {
    await chInsert(FLEET_TABLES.purchaseOrder, mapped);
  }

  await chInsert(FLEET_TABLES.jobRun, [
    {
      job_name: JOB_NAME,
      last_run_at: now,
      detail: JSON.stringify({
        inserted: mapped.length,
        deleted: toRetire.length,
        source: 'dev.vmoto_orders',
      }),
      is_deleted: false,
    },
  ]);

  return { inserted: mapped.length, deleted: toRetire.length };
}
