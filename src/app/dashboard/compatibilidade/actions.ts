'use server';

import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';
import { BIKE_MODELS } from '@/types';
import type { BikeModel } from '@/types';

// Head-gated mutations for the bike-model compatibility matrix.

export interface CompatInput {
  sku: string;
  description?: string | null;
  partNumber?: string | null;
  aplicacao?: string | null;
  nacionalizado: boolean;
  models: Record<BikeModel, boolean>;
}

export async function upsertCompat(input: CompatInput) {
  const email = await requireHead();
  const supabase = createServiceSupabase();

  const row: Record<string, unknown> = {
    sku: input.sku.trim(),
    description: input.description?.trim() || null,
    part_number: input.partNumber?.trim() || null,
    aplicacao: input.aplicacao?.trim() || null,
    nacionalizado: input.nacionalizado,
    updated_at: new Date().toISOString(),
    updated_by: email,
  };
  for (const m of BIKE_MODELS) row[m] = input.models[m] ?? false;

  const { error } = await supabase
    .schema('fleet')
    .from('part_compat')
    .upsert(row, { onConflict: 'sku' });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteCompat(sku: string) {
  await requireHead();
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .schema('fleet')
    .from('part_compat')
    .delete()
    .eq('sku', sku);
  if (error) throw new Error(error.message);
  return { ok: true };
}
