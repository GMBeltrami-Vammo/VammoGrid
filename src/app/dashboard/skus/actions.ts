'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import type { TransportModal } from '@/types/planning';

// Manually register a new SKU: write its policy (lead times, national/international,
// default modal, ABC, name) AND add it to the default scope so it shows up and is
// planned against. The warehouse snapshot won't know it until it has inventory — the
// name lives on the policy row so the SKUs page can list it in the meantime.
export interface NewSkuInput {
  skuBase: string;
  skuName?: string | null;
  leadTimeSeaDays?: number | null;
  leadTimeAirDays?: number | null;
  isNational: boolean;
  defaultModal: TransportModal;
  abcClass?: string | null;
}

export async function createSku(input: NewSkuInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const skuBase = input.skuBase.trim();
    if (!skuBase) return { ok: false, error: 'Código do SKU é obrigatório.' };

    // Policy row (holds every configured attribute + the display name).
    const currentPolicy = await readFleetRow<Row>(FLEET_TABLES.skuPolicy, { sku_base: skuBase });
    await upsertFleetRow({
      table: FLEET_TABLES.skuPolicy,
      entityType: 'sku_policy',
      entityId: skuBase,
      current: currentPolicy,
      next: {
        ...currentPolicy,
        sku_base: skuBase,
        sku_name: input.skuName?.trim() || null,
        lead_time_sea_days: input.leadTimeSeaDays ?? null,
        lead_time_air_days: input.leadTimeAirDays ?? null,
        default_modal: input.defaultModal,
        is_national: input.isNational,
        abc_class: input.abcClass?.trim() || null,
        updated_by: email,
      },
      changedBy: email,
    });

    // Add to the default visible universe.
    const currentScope = await readFleetRow<Row>(FLEET_TABLES.skuScope, { sku_base: skuBase });
    await upsertFleetRow({
      table: FLEET_TABLES.skuScope,
      entityType: 'sku_scope',
      entityId: skuBase,
      current: currentScope,
      next: { ...currentScope, sku_base: skuBase, active: true, note: 'Adicionado manualmente', updated_by: email },
      changedBy: email,
    });

    updateTag('policies');
    updateTag('sku-scope');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

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
    const current = await readFleetRow<Row>(FLEET_TABLES.skuScope, { sku_base: skuBase });

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
