import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { auth } from '@/auth';
import { syncOrdersFromClickHouse } from '@/lib/planning/ordersSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily cron (vercel.json): mirror current orders from ClickHouse dev.vmoto_orders
// into dev.fleet_purchase_order (past-ETA rows dropped). See ordersSync.ts.
async function runSync(req: Request) {
  // Allow: no CRON_SECRET (dev), valid Bearer CRON_SECRET (Vercel cron), or a
  // logged-in session (manual trigger).
  if (process.env.CRON_SECRET) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    const validCron = bearer === process.env.CRON_SECRET?.trim();
    const session = await auth();
    if (!validCron && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await syncOrdersFromClickHouse();
    revalidateTag('orders', 'max'); // refresh the cached purchase_order reads
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/orders/sync]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — Vercel cron + manual browser trigger when logged in
export const GET = runSync;
// POST — manual curl trigger with CRON_SECRET header
export const POST = runSync;
