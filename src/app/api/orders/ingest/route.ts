import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { chInsert, type Row } from '@/lib/clickhouse/reader';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/ingest — purchase-order intake from n8n.
//
// Auth: Authorization: Bearer <N8N_INGEST_SECRET>   (self-authenticating; this
//       route is excluded from the session middleware).
// Writes go through the service-role client (bypasses RLS); the anon key cannot
// write this table.
//
// Expected JSON body:
// {
//   "order_date": "2026-06-16",        // required, YYYY-MM-DD
//   "vo": "266",                        // optional reference label
//   "modal": "air" | "sea",            // optional
//   "eta": "2026-07-12",               // optional order-level default ETA
//   "lead_time_days": 26,               // optional order-level default lead time
//   "hub_id": "osasco",                // optional, default "osasco"
//   "status": "ordered",               // optional, default "ordered"
//   "replace_vo": true,                 // optional: delete existing rows with this vo first (idempotent re-send)
//   "items": [
//     { "sku": "VM-01-FRE0-1010", "qty": 200, "eta": "2026-07-12", "lead_time_days": 26 },
//     { "sku": "VM-01-SUS0-3401", "qty": 50, "sku_name": "Amortecedor traseiro" }
//   ]
// }
//
// Per item, ETA and lead_time fall back to the order-level values. If only one of
// (eta, lead_time) is known, the other is derived from order_date.
// ─────────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE, 'expected YYYY-MM-DD');
const hubId = z.enum(['mooca', 'osasco', 'sbc']);
const status = z.enum(['ordered', 'in_transit', 'customs', 'received', 'cancelled']);
const modal = z.enum(['air', 'sea']);

const ItemSchema = z.object({
  sku: z.string().min(1),
  qty: z.number().int().min(0),
  sku_name: z.string().optional(),
  eta: dateStr.optional(),
  lead_time_days: z.number().int().min(0).optional(),
  hub_id: hubId.optional(),
  status: status.optional(),
  notes: z.string().optional(),
});

const PayloadSchema = z.object({
  order_date: dateStr,
  vo: z.string().optional(),
  modal: modal.optional(),
  eta: dateStr.optional(),
  lead_time_days: z.number().int().min(0).optional(),
  hub_id: hubId.optional(),
  status: status.optional(),
  replace_vo: z.boolean().optional(),
  items: z.array(ItemSchema).min(1),
});

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function POST(req: Request) {
  // 1. Auth — shared bearer secret
  const secret = process.env.N8N_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'N8N_INGEST_SECRET not configured' },
      { status: 503 },
    );
  }
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  if (bearer !== secret.trim()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse + validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const p = parsed.data;

  // 3. Build one row per item, resolving eta / lead time with order-level fallback
  const now = new Date().toISOString();
  const rows: Row[] = p.items.map((item) => {
    const orderDate = p.order_date;
    let eta = item.eta ?? p.eta ?? null;
    let leadTime = item.lead_time_days ?? p.lead_time_days ?? null;

    if (eta && leadTime == null) leadTime = Math.max(0, diffDays(orderDate, eta));
    else if (!eta && leadTime != null) eta = addDays(orderDate, leadTime);

    return {
      id: randomUUID(),
      vo: p.vo ?? null,
      sku: item.sku,
      sku_name: item.sku_name ?? null,
      qty_ordered: item.qty,
      order_date: orderDate,
      eta,
      lead_time_days: leadTime,
      status: item.status ?? p.status ?? 'ordered',
      modal: p.modal ?? null,
      hub_id: item.hub_id ?? p.hub_id ?? 'osasco',
      notes: item.notes ?? null,
      source: 'n8n',
      created_at: now,
      updated_at: now,
      is_deleted: false,
    };
  });

  // 4. Write (ClickHouse — this is machine ingest, not a human edit, so it goes
  // through raw chInsert rather than the per-field audit-log helper, same as the
  // daily orders-sync cron: a bulk n8n batch would otherwise flood the audit log.)
  try {
    // Idempotent re-send: optionally soft-delete existing rows for this VO first
    // (insert an is_deleted=true version of each — ReplacingMergeTree keeps the newest).
    let replacedCount = 0;
    if (p.replace_vo && p.vo) {
      const existing = await readFleetTable<Row>(FLEET_TABLES.purchaseOrder);
      const toRetire = existing.filter((r) => r.vo === p.vo);
      if (toRetire.length > 0) {
        await chInsert(
          FLEET_TABLES.purchaseOrder,
          toRetire.map((r) => ({ ...r, updated_at: now, is_deleted: true })),
        );
        replacedCount = toRetire.length;
      }
    }

    await chInsert(FLEET_TABLES.purchaseOrder, rows);

    revalidateTag('orders', 'max'); // mark cached purchase_order rows stale

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      vo: p.vo ?? null,
      replaced: replacedCount > 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/orders/ingest]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
