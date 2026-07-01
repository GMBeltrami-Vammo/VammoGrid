'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Returns a structured result instead of throwing: Next.js redacts THROWN server
// action errors in production (generic "An error occurred…" + digest), so the real
// cause (e.g. a permission error) never reaches the UI. Returned values are not
// redacted, so the client can surface the actual message.

async function findPolicy(skuBase: string): Promise<Row | null> {
  const rows = await readFleetTable<Row>(FLEET_TABLES.skuPolicy);
  return rows.find((r) => r.sku_base === skuBase) ?? null;
}

export async function updateRecoveryPolicy(
  skuBase: string,
  params: { recoveryRate: number; recoveryTurnaroundDays: number; isRepairable: boolean },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await findPolicy(skuBase);

    // Update only recovery fields; leave lead_time, abc_class, etc. untouched (full-row
    // write merges over the current row — ReplacingMergeTree has no partial UPDATE).
    await upsertFleetRow({
      table: FLEET_TABLES.skuPolicy,
      entityType: 'sku_policy',
      entityId: skuBase,
      current,
      next: {
        ...current,
        sku_base: skuBase,
        recovery_rate: params.recoveryRate,
        recovery_turnaround_days: params.recoveryTurnaroundDays,
        is_repairable: params.isRepairable,
        updated_by: email,
      },
      changedBy: email,
    });

    updateTag('policies'); // read-your-own-writes: refresh cached sku_policy rows now
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

// Per-SKU safety-stock override (global). null clears the override → engine falls
// back to the computed ABC_Z[class] × σ_L. Feeds ROP = demanda no lead + safety.
export async function updateSafetyStock(
  skuBase: string,
  safetyOverride: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await findPolicy(skuBase);

    await upsertFleetRow({
      table: FLEET_TABLES.skuPolicy,
      entityType: 'sku_policy',
      entityId: skuBase,
      current,
      next: {
        ...current,
        sku_base: skuBase,
        safety_override: safetyOverride,
        updated_by: email,
      },
      changedBy: email,
    });

    updateTag('policies'); // read-your-own-writes: refresh cached sku_policy rows now
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
