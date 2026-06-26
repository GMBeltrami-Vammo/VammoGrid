'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { createServiceSupabase } from '@/lib/supabase/service';
import type { TransportModal } from '@/types/planning';

// Returns a structured result rather than throwing — Next redacts thrown server
// action errors in production, hiding the real cause (e.g. a DB permission error).
export async function updateLeadTimePolicy(
  skuBase: string,
  params: { seaDays: number; airDays: number; defaultModal: TransportModal },
): Promise<{ ok: boolean; error?: string }> {
  try {
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

    if (error) return { ok: false, error: error.message };
    updateTag('policies'); // read-your-own-writes: refresh cached sku_policy rows now
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
