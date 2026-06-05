'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { HubId, MonthlyClosing } from '@/types';

export function useMonthlyClosing(hubId: HubId) {
  return useQuery<MonthlyClosing[]>({
    queryKey: ['monthly-closing', hubId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .schema('fleet')
        .from('piece_stock_hub_monthly')
        .select(
          'closing_month, snapshot_date, sku_id, sku_name, hub_id, qty_available, avg_daily_consumption, doh',
        )
        .eq('hub_id', hubId)
        .order('closing_month', { ascending: false });

      if (error) throw error;

      return (data ?? []).map((r) => ({
        closingMonth: r.closing_month as string,
        snapshotDate: r.snapshot_date as string,
        skuId: r.sku_id as string,
        skuName: r.sku_name as string,
        hubId: r.hub_id as HubId,
        qtyAvailable: r.qty_available as number,
        avgDailyConsumption: Number(r.avg_daily_consumption) || 0,
        doh: r.doh as number | null,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
