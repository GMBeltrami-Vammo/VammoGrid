import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { refreshRecoveryRates } from '@/lib/planning/recoveryRefresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly recovery-rate refresh (Vercel cron, see vercel.json). Re-derives per-SKU
// recovery rates from the IMS ledger into fleet.sku_policy and stamps job_run.
async function runRefresh(req: Request) {
  // Allow: no CRON_SECRET (dev), valid Bearer CRON_SECRET (Vercel cron), or a
  // logged-in @vammo.com session (manual trigger).
  if (process.env.CRON_SECRET) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    const validCron = bearer === process.env.CRON_SECRET?.trim();
    const session = await auth();
    if (!validCron && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await refreshRecoveryRates();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/recovery/refresh]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — Vercel cron + manual browser trigger when logged in
export const GET = runRefresh;
// POST — manual curl trigger with CRON_SECRET header
export const POST = runRefresh;
