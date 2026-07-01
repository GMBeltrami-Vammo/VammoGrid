'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Head-gated mutations for fleet info (dev.fleet_info — formerly Supabase
// fleet.fleet_info; see decisions.MD #11) and per-SKU planning/recovery params.

export interface FleetInfoInput {
  segment: string;
  currentSize: number;
  monthlyGrowthRate: number; // fraction (0.05 = 5%/month)
  asOfDate?: string | null;
}

async function findFleetInfo(segment: string): Promise<Row | null> {
  const rows = await readFleetTable<Row>(FLEET_TABLES.fleetInfo);
  return rows.find((r) => r.segment === segment) ?? null;
}

export async function upsertFleetInfo(input: FleetInfoInput) {
  const email = await requireHead();
  const segment = input.segment.trim() || 'total';
  const current = await findFleetInfo(segment);
  await upsertFleetRow({
    table: FLEET_TABLES.fleetInfo,
    entityType: 'fleet_info',
    entityId: segment,
    current,
    next: {
      segment,
      current_size: input.currentSize,
      monthly_growth_rate: input.monthlyGrowthRate,
      as_of_date: input.asOfDate || null,
      updated_by: email,
    },
    changedBy: email,
  });
  updateTag('fleet-info');
  return { ok: true };
}

export async function deleteFleetInfo(segment: string) {
  const email = await requireHead();
  const current = await findFleetInfo(segment);
  if (!current) return { ok: true };
  await softDeleteFleetRow({
    table: FLEET_TABLES.fleetInfo,
    entityType: 'fleet_info',
    entityId: segment,
    current,
    changedBy: email,
  });
  updateTag('fleet-info');
  return { ok: true };
}

