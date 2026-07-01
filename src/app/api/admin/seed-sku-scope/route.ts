import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { chInsert, type Row } from '@/lib/clickhouse/reader';
import { FLEET_TABLES, provisionFleetTables, readFleetTable } from '@/lib/clickhouse/fleet';
import { SCOPE_SEED_SKUS } from '@/lib/planning/seed/scopeSkus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// ONE-OFF seed: populate dev.fleet_sku_scope with the 139 reference SKUs
// (sub-project A). Meant to be triggered once, verified, then deleted from the
// codebase — not a standing endpoint.
//
// Idempotent: only inserts codes not already present (active or not), so a re-run
// never duplicates or clobbers manual edits. GET (browser, logged-in Head) or
// POST (curl + CRON_SECRET) — same handler.
// ?verify=1 → read-back count only, no write.
// ─────────────────────────────────────────────────────────────────────────────

async function run(req: Request) {
  if (process.env.CRON_SECRET) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    const validCron = bearer === process.env.CRON_SECRET?.trim();
    const session = await auth();
    if (!validCron && !session?.user?.isHead) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // CREATEs always run; ALTERs are best-effort (need the ALTER grant). Any skipped
    // ALTER is reported so the operator knows to grant it and re-run.
    const { migrationErrors } = await provisionFleetTables();

    const { searchParams } = new URL(req.url);
    const existing = await readFleetTable<{ sku_base: string }>(FLEET_TABLES.skuScope);
    const existingSet = new Set(existing.map((r) => r.sku_base));

    if (searchParams.get('verify') === '1') {
      return NextResponse.json({
        ok: true,
        verified: { active_scope_rows: existing.length },
        migrationErrors,
        at: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();
    const toInsert: Row[] = SCOPE_SEED_SKUS.filter((sku) => !existingSet.has(sku)).map((sku) => ({
      sku_base: sku,
      active: true,
      note: 'seed: Spare Parts Bike v100',
      updated_by: 'seed',
      updated_at: now,
      is_deleted: false,
    }));
    await chInsert(FLEET_TABLES.skuScope, toInsert);

    const after = await readFleetTable<{ sku_base: string }>(FLEET_TABLES.skuScope);
    return NextResponse.json({
      ok: true,
      seeded: toInsert.length,
      already_present: existingSet.size,
      total_scope_rows: after.length,
      // Empty = all columns present. Non-empty = grant ALTER on dev.* and re-run to
      // finish adding lead_time_std_days/is_national/prep_status.
      migrationErrors,
      at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/admin/seed-sku-scope]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
