'use client';

import { useQuery } from '@tanstack/react-query';
import type { PurchaseOrder } from '@/types';

export function usePurchaseOrders() {
  return useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const res = await fetch('/api/fleet/purchase-orders');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 60_000,
  });
}
