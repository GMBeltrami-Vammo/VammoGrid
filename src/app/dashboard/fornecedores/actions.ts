'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
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
  leadTimeSeaDays?: number | null;
  leadTimeAirDays?: number | null;
  active?: boolean;
}

// Nullable non-negative integer for lead-time fields.
function leadDays(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.max(0, Math.round(v));
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
        lead_time_sea_days: leadDays(input.leadTimeSeaDays),
        lead_time_air_days: leadDays(input.leadTimeAirDays),
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
        lead_time_sea_days: leadDays(input.leadTimeSeaDays),
        lead_time_air_days: leadDays(input.leadTimeAirDays),
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

// ─── Supplier modals (N per supplier: Courier/Aéreo/Marítimo…) ─────────────────

export async function upsertSupplierModal(
  supplierId: string,
  input: { modalId?: string; name: string; leadDays: number },
): Promise<{ ok: boolean; modalId?: string; error?: string }> {
  try {
    const email = await requireHead();
    const name = input.name.trim();
    const lead = Math.round(input.leadDays);
    if (!name) return { ok: false, error: 'Nome do modal é obrigatório.' };
    if (!Number.isFinite(lead) || lead <= 0) return { ok: false, error: 'Lead (dias) deve ser > 0.' };
    const modalId = input.modalId ?? randomUUID();
    const current = input.modalId
      ? await readFleetRow<Row>(FLEET_TABLES.supplierModal, { supplier_id: supplierId, modal_id: modalId })
      : null;
    await upsertFleetRow({
      table: FLEET_TABLES.supplierModal,
      entityType: 'supplier_modal',
      entityId: `${supplierId}|${modalId}`,
      current,
      next: {
        ...current,
        supplier_id: supplierId,
        modal_id: modalId,
        name,
        lead_days: lead,
        sort_order: Number(current?.sort_order ?? 0),
        updated_by: email,
      },
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true, modalId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deleteSupplierModal(
  supplierId: string,
  modalId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.supplierModal, { supplier_id: supplierId, modal_id: modalId });
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.supplierModal,
      entityType: 'supplier_modal',
      entityId: `${supplierId}|${modalId}`,
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
  opts?: { isPreferred?: boolean; priority?: number; partNumber?: string | null },
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
        supplier_part_number:
          opts?.partNumber !== undefined ? opts.partNumber?.trim() || null : (current?.supplier_part_number ?? null),
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

/** Edit just the supplier's part number on an existing SKU↔supplier link (Notas P3). */
export async function setSupplierPartNumber(
  skuBase: string,
  supplierId: string,
  partNumber: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await readFleetRow<Row>(FLEET_TABLES.skuSupplier, { sku_base: skuBase, supplier_id: supplierId });
    if (!current) return { ok: false, error: 'Vínculo não encontrado.' };
    await upsertFleetRow({
      table: FLEET_TABLES.skuSupplier,
      entityType: 'sku_supplier',
      entityId: `${skuBase}|${supplierId}`,
      current,
      next: { ...current, supplier_part_number: partNumber?.trim() || null, updated_by: email },
      changedBy: email,
    });
    updateTag('suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

/**
 * Bulk-link many SKUs to ONE supplier in a single server round-trip (from the SKUs
 * table selection). Reads the small link table once, then upserts one link per SKU.
 * When makePreferred, sets it as each SKU's preferred and clears any other preferred
 * link for that SKU (keeps "one preferred per SKU"). Idempotent per SKU.
 */
export async function linkSkusToSupplier(
  skuBases: string[],
  supplierId: string,
  opts?: { makePreferred?: boolean },
): Promise<{ ok: boolean; linked?: number; error?: string }> {
  try {
    const email = await requireHead();
    if (!supplierId) return { ok: false, error: 'Fornecedor é obrigatório.' };
    const skus = [...new Set(skuBases.map((s) => s.trim()).filter(Boolean))];
    if (skus.length === 0) return { ok: false, error: 'Nenhum SKU selecionado.' };
    const makePreferred = opts?.makePreferred ?? false;

    // One read of the (small) link table, indexed by SKU.
    const allLinks = await readFleetTable<Row>(FLEET_TABLES.skuSupplier);
    const bySku = new Map<string, Row[]>();
    for (const l of allLinks) {
      const k = String(l.sku_base);
      (bySku.get(k) ?? bySku.set(k, []).get(k)!).push(l);
    }

    for (const sku of skus) {
      const existing = bySku.get(sku) ?? [];
      const current = existing.find((l) => String(l.supplier_id) === supplierId) ?? null;
      await upsertFleetRow({
        table: FLEET_TABLES.skuSupplier,
        entityType: 'sku_supplier',
        entityId: `${sku}|${supplierId}`,
        current,
        next: {
          ...current,
          sku_base: sku,
          supplier_id: supplierId,
          is_preferred: makePreferred ? true : Boolean(current?.is_preferred ?? false),
          priority: Number(current?.priority ?? 0),
          updated_by: email,
        },
        changedBy: email,
      });
      // Keep one preferred per SKU: clear the flag on this SKU's other links.
      if (makePreferred) {
        for (const l of existing) {
          if (String(l.supplier_id) === supplierId || !l.is_preferred) continue;
          await upsertFleetRow({
            table: FLEET_TABLES.skuSupplier,
            entityType: 'sku_supplier',
            entityId: `${sku}|${l.supplier_id}`,
            current: l,
            next: { ...l, is_preferred: false, updated_by: email },
            changedBy: email,
          });
        }
      }
    }
    updateTag('suppliers');
    return { ok: true, linked: skus.length };
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
