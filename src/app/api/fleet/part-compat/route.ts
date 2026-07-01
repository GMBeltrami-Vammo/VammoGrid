import { NextResponse } from 'next/server';
import { fetchCompatRows } from '@/lib/planning/source/compat';
import { mapPartCompatRow } from '@/lib/clickhouse/mappers';

export const dynamic = 'force-dynamic';

// Server-side proxy for useCompat — see purchase-orders/route.ts for why this
// exists (no safe anon-client story for ClickHouse).
export async function GET() {
  try {
    const rows = await fetchCompatRows();
    const sorted = [...rows].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    return NextResponse.json(sorted.map(mapPartCompatRow));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/part-compat]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
