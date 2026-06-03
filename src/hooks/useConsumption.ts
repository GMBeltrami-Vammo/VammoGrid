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
    staleTime: 5 * 60 * 1000, // align with server revalidate = 300s
  });
}

/**
 * Filter consumption records for a specific item name + hub.
 * Matching is case-insensitive because IMS item_group and Maestro item_group_name
 * use the same text but may differ in casing.
 */
export function useItemConsumption(itemGroup: string, hubId: HubId) {
  const query = useConsumption();
  const target = itemGroup.toLowerCase().trim();
  return {
    ...query,
    data:
      query.data?.filter(
        (r) => r.hubId === hubId && r.itemGroup.toLowerCase().trim() === target,
      ) ?? [],
  };
}
