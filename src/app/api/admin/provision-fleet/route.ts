import { NextResponse } from 'next/server';
import { requireHead } from '@/lib/auth/requireHead';
import { provisionFleetTables } from '@/lib/clickhouse/fleet';

export const dynamic = 'force-dynamic';

// Head-gated, idempotent schema provisioning: creates any missing dev.fleet_* tables
// and applies the additive column migrations (ADD COLUMN IF NOT EXISTS). Safe to hit
// any time — run it once after deploying a change that adds columns. Returns the list
// of ALTERs that were skipped (e.g. if the ClickHouse user lacks the ALTER grant).
export async function GET() {
  try {
    await requireHead();
    const { migrationErrors } = await provisionFleetTables();
    return NextResponse.json({ ok: true, migrationErrors });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
