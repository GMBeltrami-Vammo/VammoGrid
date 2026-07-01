'use client';

import { useQuery } from '@tanstack/react-query';
import type { PartCompat } from '@/types';

export function useCompat() {
  return useQuery<PartCompat[]>({
    queryKey: ['part-compat'],
    queryFn: async () => {
      const res = await fetch('/api/fleet/part-compat');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 60_000,
  });
}
