import { NextResponse } from 'next/server';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_INVENTORY } from '@/lib/metabase/queries';
import { transformInventoryRows } from '@/lib/transformer';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function runSnapshot(req: Request) {
  // If CRON_SECRET is configured, enforce it.
  // If it is not set (first deploy, local dev), allow through so the initial
  // seed can be triggered without extra setup.
  if (process.env.CRON_SECRET) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
    if (bearer !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const rows = await fetchCardJson(METABASE_QUESTION_INVENTORY);
    const items = transformInventoryRows(rows);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const upsertRows = items.map((item) => ({
      snapshot_date: today,
      sku_name:      item.skuName,
      hub_id:        item.hubId,
      qty_available: item.qtyAvailable,
      doh:           item.doh,
      doh_status:    item.dohStatus,
    }));

    const supabase = createServerSupabase();
    const { error } = await supabase
      .from('inventory_snapshots')
      .upsert(upsertRows, { onConflict: 'snapshot_date,sku_name,hub_id' });

    if (error) throw error;

    return NextResponse.json({ ok: true, date: today, count: upsertRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/inventory/snapshot]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET  — used by Vercel cron jobs (vercel.json schedule)
export const GET = runSnapshot;

// POST — used for manual triggers (curl / admin action)
export const POST = runSnapshot;
