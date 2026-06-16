'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mapFleetInfoRow } from '@/lib/supabase/mappers';
import type { FleetInfo } from '@/types';

export function useFleetInfo() {
  return useQuery<FleetInfo[]>({
    queryKey: ['fleet-info'],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('fleet_info')
        .select('*')
        .order('segment', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapFleetInfoRow);
    },
    staleTime: 60_000,
  });
}
