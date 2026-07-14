'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';

// Head-gated mutations for fleet info (dev.fleet_info — formerly Supabase
// fleet.fleet_info; see decisions.MD #11) and per-SKU planning/recovery params.

export interface FleetInfoInput {
  segment: string;
  currentSize: number;
  monthlyGrowthRate: number; // fraction (0.05 = 5%/month)
  /** Meta comercial: novas motos/mês como fração da frota (null = não informado). */
  commercialTargetPct?: number | null;
  /** Churn: motos que saem/mês como fração da frota (null = não informado). */
  churnPct?: number | null;
  asOfDate?: string | null;
}

function findFleetInfo(segment: string): Promise<Row | null> {
  return readFleetRow<Row>(FLEET_TABLES.fleetInfo, { segment });
}

export async function upsertFleetInfo(input: FleetInfoInput) {
  const email = await requireHead();
  const segment = input.segment.trim() || 'total';
  const current = await findFleetInfo(segment);
  // Merge over current so partial callers (e.g. the inline growth-rate editor, which
  // omits meta/churn) don't blank untouched columns. Meta/churn are only overridden
  // when explicitly provided; passing null clears them.
  const next: Row = {
    ...(current ?? {}),
    segment,
    current_size: input.currentSize,
    monthly_growth_rate: input.monthlyGrowthRate,
    as_of_date: input.asOfDate || null,
    updated_by: email,
  };
  if (input.commercialTargetPct !== undefined) next.commercial_target_pct = input.commercialTargetPct;
  if (input.churnPct !== undefined) next.churn_pct = input.churnPct;
  await upsertFleetRow({
    table: FLEET_TABLES.fleetInfo,
    entityType: 'fleet_info',
    entityId: segment,
    current,
    next,
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

