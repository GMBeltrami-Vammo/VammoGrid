import { NextResponse } from 'next/server';
import { fetchStockStates } from '@/lib/planning/source/stock';
import { fetchSkuPolicies } from '@/lib/planning/source/policies';

export const dynamic = 'force-dynamic';

// Lightweight SKU catalog for the client-side search typeahead (the browser can't
// query ClickHouse directly): every SKU in the warehouse snapshot ∪ manually-added
// policy-only SKUs (same union as the SKUs page), as {skuBase, skuName}. The
// underlying reads are unstable_cache'd (stock 10m / policies 5m), so this is cheap.
export async function GET() {
  try {
    const [stocks, policies] = await Promise.all([
      fetchStockStates(new Date().toISOString()),
      fetchSkuPolicies(),
    ]);
    const seen = new Set<string>();
    const out: { skuBase: string; skuName: string }[] = [];
    for (const s of stocks) {
      seen.add(s.skuBase);
      out.push({ skuBase: s.skuBase, skuName: s.skuName });
    }
    for (const [base, pol] of policies) {
      if (seen.has(base)) continue;
      out.push({ skuBase: base, skuName: pol.skuName ?? base });
    }
    out.sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));
    return NextResponse.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/fleet/skus]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
