'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import { SERVICE_LEVEL_TIER_KEY, isServiceLevelTier } from '@/lib/planning/constants';

// Head-gated writes to dev.fleet_global_settings (sub-projects B1, E1). value is a
// JSON string; every write goes through the shared audit log.
async function setSetting(key: string, value: unknown, email: string): Promise<void> {
  const rows = await readFleetTable<Row>(FLEET_TABLES.globalSettings);
  const current = rows.find((r) => r.key === key) ?? null;
  await upsertFleetRow({
    table: FLEET_TABLES.globalSettings,
    entityType: 'global_settings',
    entityId: key,
    current,
    next: { key, value: JSON.stringify(value), updated_by: email },
    changedBy: email,
  });
  updateTag('global-settings');
}

/** Set the global service-level tier (base/padrao/conservador) applied to every SKU. */
export async function setServiceLevelTier(
  tier: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    if (!isServiceLevelTier(tier)) return { ok: false, error: `Nível inválido: ${tier}` };
    await setSetting(SERVICE_LEVEL_TIER_KEY, tier, email);
    // The tier changes safety stock everywhere the purchase engine is read.
    updateTag('policies');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
