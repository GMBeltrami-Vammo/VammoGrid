import { NextResponse } from 'next/server';
import { fetchFleetInfoRows } from '@/lib/planning/source/fleetInfo';
import { mapFleetInfoRow } from '@/lib/clickhouse/mappers';

export const dynamic = 'force-dynamic';

// Server-side proxy for useFleetInfo — see purchase-orders/route.ts for why this
// exists (no safe anon-client story for ClickHouse).
export async function GET() {
  try {
    const rows = await fetchFleetInfoRows();
    const sorted = [...rows].sort((a, b) => a.segment.localeCompare(b.segment));
    return NextResponse.json(sorted.map(mapFleetInfoRow));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/fleet-info]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
