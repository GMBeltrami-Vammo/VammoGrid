import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import { fetchFleetHistoryPoints } from '@/lib/planning/source/fleetHistoryWarehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Head-gated, one-off backfill: seed dev.fleet_size_weekly with MONTHLY RENTABLE fleet-size
// control points read from analytics.mart_weekly_fleet_status (CPX + COMFORT). Writes go
// straight through the audited upsertFleetRow (NOT the upsertWeeklySize Server Action — its
// updateTag() call is illegal in a Route Handler); the cache is busted once at the end with
// revalidateTag, which route handlers are allowed to call. Idempotent by (segment, month);
// manual points on other dates are untouched. Run once while logged in as Head:
//   GET /api/admin/backfill-fleet-history
export async function GET() {
  try {
    const changedBy = await requireHead();
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
      try {
        const current = await readFleetRow<Row>(FLEET_TABLES.fleetSizeWeekly, {
          segment: p.segment,
          week_start: p.monthStart,
        });
        await upsertFleetRow({
          table: FLEET_TABLES.fleetSizeWeekly,
          entityType: 'fleet_size_weekly',
          entityId: `${p.segment}|${p.monthStart}`,
          current,
          next: { segment: p.segment, week_start: p.monthStart, size: p.size, updated_by: changedBy },
          changedBy,
        });
        written++;
      } catch (e) {
        errors.push(`${p.segment}|${p.monthStart}: ${e instanceof Error ? e.message : 'erro'}`);
      }
    }
    // Bust the fleet-size read cache so the Frota tab reflects the backfill immediately.
    revalidateTag('fleet-size', 'max');
    return NextResponse.json({ ok: errors.length === 0, points: points.length, written, errors });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
