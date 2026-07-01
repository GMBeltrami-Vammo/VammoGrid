'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Head-gated: add/remove a SKU from the default visible universe (sub-project A3,
// dev.fleet_sku_scope). "In scope" = a live row with active = true. Removing sets
// active = false (keeps the row + its history/note) rather than deleting, so the
// distinction between "never scoped" and "explicitly excluded" is preserved.
export async function setSkuScope(
  skuBase: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const rows = await readFleetTable<Row>(FLEET_TABLES.skuScope);
    const current = rows.find((r) => r.sku_base === skuBase) ?? null;

    await upsertFleetRow({
      table: FLEET_TABLES.skuScope,
      entityType: 'sku_scope',
      entityId: skuBase,
      current,
      next: { ...current, sku_base: skuBase, active, updated_by: email },
      changedBy: email,
    });

    updateTag('sku-scope'); // read-your-own-writes: refresh the cached scope set
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
