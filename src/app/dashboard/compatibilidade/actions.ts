'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import { BIKE_MODELS } from '@/types';
import type { BikeModel } from '@/types';

// Head-gated mutations for the bike-model compatibility matrix (dev.fleet_part_compat
// — formerly Supabase fleet.part_compat; see decisions.MD #11).

export interface CompatInput {
  sku: string;
  description?: string | null;
  partNumber?: string | null;
  aplicacao?: string | null;
  nacionalizado: boolean;
  models: Record<BikeModel, boolean>;
}

function findCompat(sku: string): Promise<Row | null> {
  return readFleetRow<Row>(FLEET_TABLES.partCompat, { sku });
}

export async function upsertCompat(input: CompatInput) {
  const email = await requireHead();
  const sku = input.sku.trim();
  const current = await findCompat(sku);

  const next: Record<string, unknown> = {
    sku,
    description: input.description?.trim() || null,
    part_number: input.partNumber?.trim() || null,
    aplicacao: input.aplicacao?.trim() || null,
    nacionalizado: input.nacionalizado,
    updated_by: email,
  };
  for (const m of BIKE_MODELS) next[m] = input.models[m] ?? false;

  await upsertFleetRow({
    table: FLEET_TABLES.partCompat,
    entityType: 'part_compat',
    entityId: sku,
    current,
    next,
    changedBy: email,
  });
  updateTag('compat');
  return { ok: true };
}

export async function deleteCompat(sku: string) {
  const email = await requireHead();
  const current = await findCompat(sku);
  if (!current) return { ok: true };
  await softDeleteFleetRow({
    table: FLEET_TABLES.partCompat,
    entityType: 'part_compat',
    entityId: sku,
    current,
    changedBy: email,
  });
  updateTag('compat');
  return { ok: true };
}
