'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import type { HubId } from '@/types/planning';

// Head-gated per-SKU/hub max-stock caps (sub-project B3). Composite key is
// (sku_base, hub_id) → the audit entityId is `${sku}|${hub}`. Passing max=null
// clears the cap (soft-delete).
export async function setHubMaxStock(
  skuBase: string,
  hubId: HubId,
  maxQty: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const entityId = `${skuBase}|${hubId}`;
    const current = await readFleetRow<Row>(FLEET_TABLES.hubMaxStock, { sku_base: skuBase, hub_id: hubId });

    if (maxQty == null) {
      if (current) {
        await softDeleteFleetRow({
          table: FLEET_TABLES.hubMaxStock,
          entityType: 'hub_max_stock',
          entityId,
          current,
          changedBy: email,
        });
      }
    } else {
      await upsertFleetRow({
        table: FLEET_TABLES.hubMaxStock,
        entityType: 'hub_max_stock',
        entityId,
        current,
        next: { sku_base: skuBase, hub_id: hubId, max_qty: Math.max(0, Math.round(maxQty)), updated_by: email },
        changedBy: email,
      });
    }
    updateTag('hub-max-stock');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
