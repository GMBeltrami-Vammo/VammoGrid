'use server';

import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';
import type { TransportModal } from '@/types/planning';

export async function updateLeadTimePolicy(
  skuBase: string,
  params: { seaDays: number; airDays: number; defaultModal: TransportModal },
) {
  const email = await requireHead();
  const supabase = createServiceSupabase();

  // Update only the modal lead-time fields; leave recovery, abc_class, etc. untouched.
  // On INSERT (first edit for this SKU), DB defaults fill the remaining required columns.
  // Effective leadTimeDays is derived at read time (buildPolicies) from defaultModal.
  const { error } = await supabase
    .schema('fleet')
    .from('sku_policy')
    .upsert(
      {
        sku_base: skuBase,
        lead_time_sea_days: params.seaDays,
        lead_time_air_days: params.airDays,
        default_modal: params.defaultModal,
        updated_by: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'sku_base' },
    );

  if (error) throw new Error(error.message);
  return { ok: true };
}
