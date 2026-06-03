import { NextResponse } from 'next/server';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_INVENTORY } from '@/lib/metabase/queries';
import { transformInventoryRows } from '@/lib/transformer';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Triggered daily by Vercel cron (vercel.json) at 09:00 UTC (06:00 BRT).
// Also callable manually: POST /api/inventory/snapshot
// with Authorization: Bearer <CRON_SECRET>
export async function POST(req: Request) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
