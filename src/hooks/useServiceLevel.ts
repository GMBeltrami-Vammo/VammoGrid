'use client';

import { useQuery } from '@tanstack/react-query';
import type { ServiceLevelTier } from '@/lib/planning/constants';

export function useServiceLevel() {
  return useQuery<{ serviceLevelTier: ServiceLevelTier }>({
    queryKey: ['global-settings'],
    queryFn: async () => {
      const res = await fetch('/api/fleet/global-settings');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 60_000,
  });
}
