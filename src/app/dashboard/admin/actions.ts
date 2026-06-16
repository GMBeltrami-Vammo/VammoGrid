'use server';

import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';

// Head-gated mutations for fleet info and per-SKU planning/recovery params.

export interface FleetInfoInput {
  segment: string;
  currentSize: number;
  monthlyGrowthRate: number; // fraction (0.05 = 5%/month)
  asOfDate?: string | null;
}

export async function upsertFleetInfo(input: FleetInfoInput) {
  const email = await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('fleet_info')
    .upsert(
      {
        segment: input.segment.trim() || 'total',
        current_size: input.currentSize,
        monthly_growth_rate: input.monthlyGrowthRate,
        as_of_date: input.asOfDate || null,
        updated_at: new Date().toISOString(),
        updated_by: email,
      },
      { onConflict: 'segment' },
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteFleetInfo(segment: string) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('fleet_info')
    .delete()
    .eq('segment', segment);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export interface SkuParamsInput {
  sku: string;
  recoveryRate: number;
  recoveryLookbackDays: number;
  leadTimeDays?: number | null;
  abcClass?: string | null;
  targetDoi?: number | null;
}

export async function upsertSkuParams(input: SkuParamsInput) {
  const email = await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('sku_params')
    .upsert(
      {
        sku: input.sku.trim(),
        recovery_rate: input.recoveryRate,
        recovery_lookback_days: input.recoveryLookbackDays,
        lead_time_days: input.leadTimeDays ?? null,
        abc_class: input.abcClass?.trim() || null,
        target_doi: input.targetDoi ?? null,
        updated_at: new Date().toISOString(),
        updated_by: email,
      },
      { onConflict: 'sku' },
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteSkuParams(sku: string) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('sku_params')
    .delete()
    .eq('sku', sku);
  if (error) throw new Error(error.message);
  return { ok: true };
}
