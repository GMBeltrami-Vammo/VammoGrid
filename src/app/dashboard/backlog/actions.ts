'use server';

import { randomUUID } from 'crypto';
import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Backlog / motos paradas registry (sub-project G). Head-gated; audit-logged.
export type BacklogStatus = 'parado' | 'em_reparo' | 'reativado';

export interface BacklogInput {
  model: string;
  stalledSince: string;
  reason?: string | null;
  notes?: string | null;
}

async function findBacklog(id: string): Promise<Row | null> {
  const rows = await readFleetTable<Row>(FLEET_TABLES.backlogBikeLog);
  return rows.find((r) => r.id === id) ?? null;
}

export async function addBacklog(input: BacklogInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    if (!input.model?.trim()) return { ok: false, error: 'Modelo é obrigatório.' };
    if (!input.stalledSince) return { ok: false, error: 'Data de parada é obrigatória.' };
    const id = randomUUID();
    await upsertFleetRow({
      table: FLEET_TABLES.backlogBikeLog,
      entityType: 'backlog_bike_log',
      entityId: id,
      current: null,
      next: {
        id,
        model: input.model.trim(),
        stalled_since: input.stalledSince,
        reason: input.reason?.trim() || null,
        status: 'parado',
        resolved_at: null,
        notes: input.notes?.trim() || null,
        created_by: email,
        created_at: new Date().toISOString(),
      },
      changedBy: email,
    });
    updateTag('backlog');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function updateBacklogStatus(
  id: string,
  status: BacklogStatus,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await findBacklog(id);
    if (!current) return { ok: false, error: 'Registro não encontrado.' };
    await upsertFleetRow({
      table: FLEET_TABLES.backlogBikeLog,
      entityType: 'backlog_bike_log',
      entityId: id,
      current,
      next: {
        ...current,
        status,
        resolved_at: status === 'reativado' ? new Date().toISOString().slice(0, 10) : null,
      },
      changedBy: email,
    });
    updateTag('backlog');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deleteBacklog(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const current = await findBacklog(id);
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.backlogBikeLog,
      entityType: 'backlog_bike_log',
      entityId: id,
      current,
      changedBy: email,
    });
    updateTag('backlog');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
