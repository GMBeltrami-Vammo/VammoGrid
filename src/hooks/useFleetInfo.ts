'use client';

import { useQuery } from '@tanstack/react-query';
import type { FleetInfo } from '@/types';

export function useFleetInfo() {
  return useQuery<FleetInfo[]>({
    queryKey: ['fleet-info'],
    queryFn: async () => {
      const res = await fetch('/api/fleet/fleet-info');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 60_000,
  });
}
