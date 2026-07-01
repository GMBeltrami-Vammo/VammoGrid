'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import type { TransportModal } from '@/types/planning';

// Returns a structured result rather than throwing — Next redacts thrown server
// action errors in production, hiding the real cause (e.g. a permission error).
export async function updateLeadTimePolicy(
  skuBase: string,
  params: { seaDays: number; airDays: number; defaultModal: TransportModal },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const rows = await readFleetTable<Row>(FLEET_TABLES.skuPolicy);
    const current = rows.find((r) => r.sku_base === skuBase) ?? null;

    // Update only the modal lead-time fields; leave recovery, abc_class, etc. untouched
    // (full-row write merges over the current row — ReplacingMergeTree has no partial
    // UPDATE). Effective leadTimeDays is derived at read time (buildPolicies) from
    // defaultModal.
    await upsertFleetRow({
      table: FLEET_TABLES.skuPolicy,
      entityType: 'sku_policy',
      entityId: skuBase,
      current,
      next: {
        ...current,
        sku_base: skuBase,
        lead_time_sea_days: params.seaDays,
        lead_time_air_days: params.airDays,
        default_modal: params.defaultModal,
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
