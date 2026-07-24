import { NextResponse, type NextRequest } from 'next/server';
import { buildSkuSummary } from '@/lib/planning/skuSummary';

export const dynamic = 'force-dynamic';

// Server-side data for the app-wide SKU popup (Feature D). Reuses the SKU deep-dive
// building blocks (loadSkuView + projectSku + history + naive comparisons + mini-strip)
// for ONE sku — cheap, no whole-snapshot recompute. Auth is inherited from the session
// middleware (any /api/* without a @vammo.com session → 401); do NOT add to the matcher.
export async function GET(req: NextRequest) {
  try {
    const sku = req.nextUrl.searchParams.get('sku')?.trim() ?? '';
    if (!sku) return NextResponse.json({ error: 'Missing ?sku=' }, { status: 400 });
    const summary = await buildSkuSummary(sku);
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/sku-summary]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
