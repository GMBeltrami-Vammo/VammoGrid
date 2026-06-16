'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { mapPurchaseOrderRow } from '@/lib/supabase/mappers';
import type { PurchaseOrder } from '@/types';

export function usePurchaseOrders() {
  return useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('purchase_order')
        .select('*')
        .order('order_date', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPurchaseOrderRow);
    },
    staleTime: 60_000,
  });
}
