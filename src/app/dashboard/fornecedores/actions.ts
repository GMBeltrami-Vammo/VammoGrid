'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import type { SupplierKind } from '@/types';

// Head-gated, audited writes for the supplier registry + SKU↔supplier links (review
// 4b). Same shape as createSku: read current → full-row merge upsert → updateTag.
// No engine change — suppliers are cadastro/linking only.

export interface SupplierInput {
  name: string;
  kind: SupplierKind;
  contact?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function createSupplier(input: SupplierInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const email = await requireHead();
    const name = input.name.trim();
    if (!name) return { ok: false, error: 'Nome é obrigatório.' };
    const id = randomUUID();
    await upsertFleetRow({
      table: FLEET_TABLES.supplier,
      entityType: 'supplier',
      entityId: id,
      current: null,
      next: {
        supplier_id: id,
        name,
        kind: input.kind,
        contact: input.contact?.trim() || null,
        notes: input.notes?.trim() || null,
        active: input.active ?? true,
        updated_by: email,
      },
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function updateSupplier(
  supplierId: string,
  input: SupplierInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.supplier, { supplier_id: supplierId });
    if (!current) return { ok: false, error: 'Fornecedor não encontrado.' };
    await upsertFleetRow({
      table: FLEET_TABLES.supplier,
      entityType: 'supplier',
      entityId: supplierId,
      current,
      next: {
        ...current,
        name: input.name.trim(),
        kind: input.kind,
        contact: input.contact?.trim() || null,
        notes: input.notes?.trim() || null,
        active: input.active ?? true,
        updated_by: email,
      },
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deleteSupplier(supplierId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.supplier, { supplier_id: supplierId });
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.supplier,
      entityType: 'supplier',
      entityId: supplierId,
      current,
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

// ─── SKU ↔ supplier links ─────────────────────────────────────────────────────

export async function linkSkuSupplier(
  skuBase: string,
  supplierId: string,
  opts?: { isPreferred?: boolean; priority?: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.skuSupplier, { sku_base: skuBase, supplier_id: supplierId });
    await upsertFleetRow({
      table: FLEET_TABLES.skuSupplier,
      entityType: 'sku_supplier',
      entityId: `${skuBase}|${supplierId}`,
      current,
      next: {
        ...current,
        sku_base: skuBase,
        supplier_id: supplierId,
        is_preferred: opts?.isPreferred ?? Boolean(current?.is_preferred) ?? false,
        priority: opts?.priority ?? Number(current?.priority ?? 0),
        updated_by: email,
      },
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function unlinkSkuSupplier(
  skuBase: string,
  supplierId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.skuSupplier, { sku_base: skuBase, supplier_id: supplierId });
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.skuSupplier,
      entityType: 'sku_supplier',
      entityId: `${skuBase}|${supplierId}`,
      current,
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

/**
 * Mark ONE supplier as the SKU's preferred, clearing the flag on the SKU's other
 * links (a SKU has at most one preferred supplier).
 */
export async function setPreferredSupplier(
  skuBase: string,
  supplierId: string,
  allSupplierIdsForSku: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    for (const sid of allSupplierIdsForSku) {
      const current = await readFleetRow<Row>(FLEET_TABLES.skuSupplier, { sku_base: skuBase, supplier_id: sid });
      if (!current) continue;
      const shouldBe = sid === supplierId;
      if (Boolean(current.is_preferred) === shouldBe) continue; // no-op
      await upsertFleetRow({
        table: FLEET_TABLES.skuSupplier,
        entityType: 'sku_supplier',
        entityId: `${skuBase}|${sid}`,
        current,
        next: { ...current, is_preferred: shouldBe, updated_by: email },
        changedBy: email,
      });
    }
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
