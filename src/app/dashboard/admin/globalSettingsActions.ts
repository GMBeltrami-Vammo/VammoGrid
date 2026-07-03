'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import {
  PURCHASE_CRITERIA_KEY,
  SERVICE_LEVEL_TIER_KEY,
  isServiceLevelTier,
  parsePurchaseCriteria,
} from '@/lib/planning/constants';

// Head-gated writes to dev.fleet_global_settings (sub-projects B1, E1). value is a
// JSON string; every write goes through the shared audit log.
async function setSetting(key: string, value: unknown, email: string): Promise<void> {
  const current = await readFleetRow<Row>(FLEET_TABLES.globalSettings, { key });
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
    // setSetting already busts 'global-settings' — the only cache holding the tier.
    // (The sku_policy cache doesn't contain it, and engine outputs are computed
    // per-request, so busting 'policies' here just discarded a warm cache.)
    await setSetting(SERVICE_LEVEL_TIER_KEY, tier, email);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

/** Set the purchase/request criteria: mode ('doh' | 'rop') + the DOH threshold. Drives
 *  Compras' "Novo Pedido" list and the Semanas heatmap "low" coloring. */
export async function setPurchaseCriteria(input: {
  mode: string;
  dohThreshold: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const criteria = parsePurchaseCriteria(input);
    await setSetting(PURCHASE_CRITERIA_KEY, criteria, email);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
