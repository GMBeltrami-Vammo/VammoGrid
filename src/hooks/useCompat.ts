'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mapPartCompatRow } from '@/lib/supabase/mappers';
import type { PartCompat } from '@/types';

export function useCompat() {
  return useQuery<PartCompat[]>({
    queryKey: ['part-compat'],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('part_compat')
        .select('*')
        .order('sku', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapPartCompatRow);
    },
    staleTime: 60_000,
  });
}
