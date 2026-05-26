'use client';

import { useQuery } from '@tanstack/react-query';
import type { ConsumptionRecord, HubId } from '@/types';

async function fetchConsumption(): Promise<ConsumptionRecord[]> {
  const res = await fetch('/api/metabase/consumption');
  if (!res.ok) throw new Error('Failed to load consumption data');
  return res.json();
}

export function useConsumption() {
  return useQuery<ConsumptionRecord[]>({
    queryKey: ['consumption'],
    queryFn: fetchConsumption,
  });
}

export function useSkuConsumption(skuId: string, hubId: HubId) {
  const query = useConsumption();
  return {
    ...query,
    data:
      query.data?.filter(
        (r) => r.skuId === skuId && r.hubId === hubId,
      ) ?? [],
  };
}
