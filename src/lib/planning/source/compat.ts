import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { BIKE_MODELS } from '@/types';
import { toSkuBase } from '../sku';

// Bike-model compatibility from Supabase fleet.part_compat (the 9-model matrix; the
// warehouse only knows the coarse BIKE/BATTERY/BOX category). Keyed by sku_base.
// Returns an empty map if Supabase is unconfigured — the filter then just won't
// constrain by model.

export async function fetchCompatModels(): Promise<Map<string, Set<string>>> {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.schema('fleet').from('part_compat').select('*');
    if (error || !data) return new Map();
    const map = new Map<string, Set<string>>();
    for (const row of data as Record<string, unknown>[]) {
      const base = toSkuBase(String(row.sku ?? ''));
      if (!base) continue;
      const set = map.get(base) ?? new Set<string>();
      for (const m of BIKE_MODELS) if (row[m] === true) set.add(m);
      map.set(base, set);
    }
    return map;
  } catch {
    return new Map();
  }
}
