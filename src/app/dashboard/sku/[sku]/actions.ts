'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';

// Returns a structured result instead of throwing: Next.js redacts THROWN server
// action errors in production (generic "An error occurred…" + digest), so the real
// cause (e.g. a DB permission error) never reaches the UI. Returned values are not
// redacted, so the client can surface the actual message.
export async function updateRecoveryPolicy(
  skuBase: string,
  params: { recoveryRate: number; recoveryTurnaroundDays: number; isRepairable: boolean },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const supabase = createServiceSupabase();

    // Update only recovery fields; leave lead_time, abc_class, etc. untouched.
    // On INSERT (first edit for this SKU), DB defaults fill the remaining required columns.
    const { error } = await supabase
      .schema('fleet')
      .from('sku_policy')
      .upsert(
        {
          sku_base: skuBase,
          recovery_rate: params.recoveryRate,
          recovery_turnaround_days: params.recoveryTurnaroundDays,
          is_repairable: params.isRepairable,
          updated_by: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'sku_base' },
      );

    if (error) return { ok: false, error: error.message };
    updateTag('policies'); // read-your-own-writes: refresh cached sku_policy rows now
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

// Per-SKU safety-stock override (global). null clears the override → engine falls
// back to the computed ABC_Z[class] × σ_L. Feeds ROP = demanda no lead + safety.
export async function updateSafetyStock(
  skuBase: string,
  safetyOverride: number | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const supabase = createServiceSupabase();

    const { error } = await supabase
      .schema('fleet')
      .from('sku_policy')
      .upsert(
        {
          sku_base: skuBase,
          safety_override: safetyOverride,
          updated_by: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'sku_base' },
      );

    if (error) return { ok: false, error: error.message };
    updateTag('policies'); // read-your-own-writes: refresh cached sku_policy rows now
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
