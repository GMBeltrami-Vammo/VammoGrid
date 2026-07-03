import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';

export const dynamic = 'force-dynamic';

// Head-gated manual cache refresh for the WAREHOUSE-DRIVEN caches — the ones with no
// write-path bust (they normally wait out their TTL: forecast 6h, stock 10m, alerts
// 10m, shares 6h, recovery-rates 6h). Hit this after an upstream SOP run / ledger
// backfill to see fresh numbers immediately. Tags with an in-app write path (orders,
// policies, sku-scope, global-settings, compat, fleet-info, hub-max-stock) are
// deliberately NOT listed — their writes already bust them.
//
// GET /api/admin/refresh-cache            → refresh all warehouse tags
// GET /api/admin/refresh-cache?tag=forecast → refresh one
const REFRESHABLE_TAGS = ['forecast', 'stock', 'alerts', 'shares', 'recovery-rates'] as const;

export async function GET(req: Request) {
  try {
    await requireHead();
    const tag = new URL(req.url).searchParams.get('tag') ?? 'all';
    const refreshed =
      tag === 'all' ? [...REFRESHABLE_TAGS] : REFRESHABLE_TAGS.filter((t) => t === tag);
    if (refreshed.length === 0) {
      return NextResponse.json(
        { ok: false, error: `Tag inválida: "${tag}". Use: ${REFRESHABLE_TAGS.join('|')}|all` },
        { status: 400 },
      );
    }
    for (const t of refreshed) revalidateTag(t, 'max');
    return NextResponse.json({ ok: true, refreshed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
