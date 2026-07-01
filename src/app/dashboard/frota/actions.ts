'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Frota manual ledgers (sub-project F): hand-entered bike sales / moto orders.
// Head-gated; every write goes through the shared audit log.

export type FrotaLog = 'sales' | 'orders';

const TABLE: Record<FrotaLog, string> = {
  sales: FLEET_TABLES.bikeSalesLog,
  orders: FLEET_TABLES.bikeOrderLog,
};
const ENTITY: Record<FrotaLog, string> = {
  sales: 'bike_sales_log',
  orders: 'bike_order_log',
};

export interface FrotaEntryInput {
  date: string;
  model: string;
  qty: number;
  note?: string | null;
}

export async function addFrotaEntry(
  log: FrotaLog,
  input: FrotaEntryInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    if (!input.date) return { ok: false, error: 'Data é obrigatória.' };
    if (!input.model?.trim()) return { ok: false, error: 'Modelo é obrigatório.' };
    if (!Number.isFinite(input.qty)) return { ok: false, error: 'Quantidade inválida.' };
    const id = randomUUID();
    await upsertFleetRow({
      table: TABLE[log],
      entityType: ENTITY[log],
      entityId: id,
      current: null,
      next: {
        id,
        date: input.date,
        model: input.model.trim(),
        qty: Math.round(input.qty),
        note: input.note?.trim() || null,
        created_by: email,
        created_at: new Date().toISOString(),
      },
      changedBy: email,
    });
    updateTag('frota-logs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deleteFrotaEntry(
  log: FrotaLog,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const rows = await readFleetTable<Row>(TABLE[log]);
    const current = rows.find((r) => r.id === id);
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: TABLE[log],
      entityType: ENTITY[log],
      entityId: id,
      current,
      changedBy: email,
    });
    updateTag('frota-logs');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
