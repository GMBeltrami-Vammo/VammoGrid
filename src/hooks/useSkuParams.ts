'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mapSkuParamsRow } from '@/lib/supabase/mappers';
import type { SkuParams } from '@/types';

export function useSkuParams() {
  return useQuery<SkuParams[]>({
    queryKey: ['sku-params'],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('sku_params')
        .select('*');
      if (error) throw error;
      return (data ?? []).map(mapSkuParamsRow);
    },
    staleTime: 60_000,
  });
}
