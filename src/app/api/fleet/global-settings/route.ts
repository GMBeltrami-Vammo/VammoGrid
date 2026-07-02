import { NextResponse } from 'next/server';
import { fetchServiceLevelTier, fetchPurchaseCriteria } from '@/lib/planning/source/globalSettings';

export const dynamic = 'force-dynamic';

// Server-side proxy for the client-side global-settings panel — the browser can't
// query ClickHouse directly. Returns the resolved active service-level tier + the
// purchase/request criteria.
export async function GET() {
  try {
    const [serviceLevelTier, purchaseCriteria] = await Promise.all([
      fetchServiceLevelTier(),
      fetchPurchaseCriteria(),
    ]);
    return NextResponse.json({ serviceLevelTier, purchaseCriteria });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/global-settings]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
