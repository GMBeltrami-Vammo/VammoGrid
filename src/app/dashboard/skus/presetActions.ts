'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import { MAX_SELECTED_SKUS } from '@/lib/planning/filter';

// Head-gated, audited writes for named selection presets (custom filters). A preset is
// a saved SKU list (JSON) the team re-applies as the app-wide recorte. Applying is
// client-side (writeSkusCookies) — no action needed to APPLY, only to save/delete.

export async function savePreset(
  name: string,
  skus: string[],
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const email = await requireHead();
    const clean = name.trim();
    if (!clean) return { ok: false, error: 'Nome é obrigatório.' };
    const list = [...new Set(skus.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SELECTED_SKUS);
    if (list.length === 0) return { ok: false, error: 'Selecione ao menos um SKU antes de salvar.' };

    const id = randomUUID();
    await upsertFleetRow({
      table: FLEET_TABLES.filterPreset,
      entityType: 'filter_preset',
      entityId: id,
      current: null,
      next: { preset_id: id, name: clean, skus: JSON.stringify(list), note: null, updated_by: email },
      changedBy: email,
    });
    updateTag('filter-presets');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deletePreset(presetId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.filterPreset, { preset_id: presetId });
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.filterPreset,
      entityType: 'filter_preset',
      entityId: presetId,
      current,
      changedBy: email,
    });
    updateTag('filter-presets');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
