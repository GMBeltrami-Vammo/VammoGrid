'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { HubId, InventorySnapshot } from '@/types';

const THIRTY_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};

export function useInventoryHistory(skuName: string, hubId: HubId) {
  return useQuery<InventorySnapshot[]>({
    queryKey: ['inventory-history', skuName, hubId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('piece_stock_hub')
        .select('snapshot_date, qty_available, doh, doh_status')
        .eq('sku_name', skuName)
        .eq('hub_id', hubId)
        .gte('snapshot_date', THIRTY_DAYS_AGO())
        .order('snapshot_date', { ascending: true });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        snapshotDate: row.snapshot_date as string,
        skuName,
        hubId,
        qtyAvailable: row.qty_available as number,
        doh: row.doh as number | null,
        dohStatus: (row.doh_status ?? 'unknown') as InventorySnapshot['dohStatus'],
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
