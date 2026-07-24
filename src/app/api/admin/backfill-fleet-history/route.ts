import { NextResponse } from 'next/server';
import { requireHead } from '@/lib/auth/requireHead';
import { fetchFleetHistoryPoints } from '@/lib/planning/source/fleetHistoryWarehouse';
import { upsertWeeklySize } from '@/app/dashboard/frota/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Head-gated, one-off backfill: seed dev.fleet_size_weekly with MONTHLY RENTABLE fleet-size
// control points read from analytics.mart_weekly_fleet_status (CPX + COMFORT). Each point is
// written through the audited upsertWeeklySize, keyed by (segment, month-start). Idempotent —
// re-running replaces the same monthly points; manual points on other dates are untouched.
// Run once from the browser while logged in as Head: GET /api/admin/backfill-fleet-history
export async function GET() {
  try {
    await requireHead();
    const points = await fetchFleetHistoryPoints();
    if (points.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Nenhum ponto lido de analytics.mart_weekly_fleet_status (RENTABLE).' },
        { status: 500 },
      );
    }
    let written = 0;
    const errors: string[] = [];
    for (const p of points) {
      const res = await upsertWeeklySize(p.segment, p.monthStart, p.size);
      if (res.ok) written++;
      else errors.push(`${p.segment}|${p.monthStart}: ${res.error ?? 'erro'}`);
    }
    return NextResponse.json({ ok: errors.length === 0, points: points.length, written, errors });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
