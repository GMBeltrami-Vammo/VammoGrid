import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_INVENTORY } from '@/lib/metabase/queries';
import { transformInventoryRows } from '@/lib/transformer';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Give the heavy 5-CTE inventory query room to run fresh (see ignoreCache below).
// 60s is the max on Hobby and well within Pro's limit.
export const maxDuration = 60;

async function runSnapshot(req: Request) {
  // Allow if ANY of these is true:
  //   1. CRON_SECRET not configured (dev / initial seed)
  //   2. Valid Authorization: Bearer <CRON_SECRET> header  (Vercel cron)
  //   3. Valid @vammo.com Auth.js session cookie           (logged-in user)
  if (process.env.CRON_SECRET) {
    // trim() guards against a trailing newline/BOM in the CRON_SECRET value
    // (headers strip the newline in transit but process.env keeps it → mismatch)
    const bearer  = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    const validCron = bearer === process.env.CRON_SECRET?.trim();

    const session = await auth();
    const validSession = !!session?.user;

    if (!validCron && !validSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // ignoreCache: true — the daily snapshot must capture fresh data even if
    // Metabase's result cache is cold at 06:00 BRT. maxDuration=60 covers the run.
    const rows = await fetchCardJson(METABASE_QUESTION_INVENTORY, true);
    const items = transformInventoryRows(rows);

    const today = new Date().toISOString().slice(0, 10);

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
      .schema('fleet')
      .from('piece_stock_hub')
      .upsert(upsertRows, { onConflict: 'snapshot_date,sku_name,hub_id' });

    if (error) throw error;

    // ── Monthly closing ───────────────────────────────────────────────────
    // On day 30 (or the last day of a shorter month, e.g. Feb 28/29) also write
    // a month-closing record: stock + avg daily consumption (L30D) per SKU/hub.
    // Reuses this same cron + freshly-fetched data — no second cron needed.
    const now = new Date();
    const day = now.getUTCDate();
    const lastDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const isMonthlyClose = day === 30 || (day === lastDay && lastDay < 30);

    let monthlyCount = 0;
    if (isMonthlyClose) {
      const closingMonth = `${now.getUTCFullYear()}-${String(
        now.getUTCMonth() + 1,
      ).padStart(2, '0')}-01`;

      const monthlyRows = items.map((item) => ({
        closing_month:         closingMonth,
        snapshot_date:         today,
        sku_id:                item.skuId,
        sku_name:              item.skuName,
        hub_id:                item.hubId,
        qty_available:         item.qtyAvailable,
        avg_daily_consumption: item.dailyConsumption,
        doh:                   item.doh,
      }));

      const { error: monthlyError } = await supabase
        .schema('fleet')
        .from('piece_stock_hub_monthly')
        .upsert(monthlyRows, { onConflict: 'closing_month,sku_id,hub_id' });

      if (monthlyError) throw monthlyError;
      monthlyCount = monthlyRows.length;
    }

    return NextResponse.json({
      ok: true,
      date: today,
      count: upsertRows.length,
      monthlyClose: isMonthlyClose,
      monthlyCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/inventory/snapshot]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET  — Vercel cron (vercel.json) + browser navigation when logged in
export const GET = runSnapshot;

// POST — manual curl trigger with CRON_SECRET header
export const POST = runSnapshot;
