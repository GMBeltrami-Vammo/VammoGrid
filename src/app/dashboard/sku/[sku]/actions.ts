'use server';

import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';

export async function updateRecoveryPolicy(
  skuBase: string,
  params: { recoveryRate: number; recoveryTurnaroundDays: number; isRepairable: boolean },
) {
  await requireHead();
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'sku_base' },
    );

  if (error) throw new Error(error.message);
  return { ok: true };
}
