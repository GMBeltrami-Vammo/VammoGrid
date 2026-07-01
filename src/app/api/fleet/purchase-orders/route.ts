import { NextResponse } from 'next/server';
import { fetchOrderRows } from '@/lib/planning/source/orders';
import { mapPurchaseOrderRow } from '@/lib/clickhouse/mappers';

export const dynamic = 'force-dynamic';

// Server-side proxy for usePurchaseOrders — the client can no longer query
// ClickHouse directly (no safe anon-client story), unlike the old Supabase anon
// key. Auth: the normal session middleware (this route is not in its exclusion
// list), so only logged-in @vammo.com users ever reach it.
export async function GET() {
  try {
    const rows = await fetchOrderRows();
    return NextResponse.json(rows.map(mapPurchaseOrderRow));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/purchase-orders]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
