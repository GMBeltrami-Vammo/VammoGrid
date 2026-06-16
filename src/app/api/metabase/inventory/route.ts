import { NextResponse } from 'next/server';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_INVENTORY } from '@/lib/metabase/queries';
import { transformInventoryRows } from '@/lib/transformer';

// Live, auth-protected inventory — render at request time, never prerender at
// build (build-time fetching of live Metabase data is fragile and pointless for
// an authenticated route). Client-side react-query handles caching.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await fetchCardJson(METABASE_QUESTION_INVENTORY);
    const items = transformInventoryRows(rows);
    return NextResponse.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/metabase/inventory]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
