'use client';

import { useQuery } from '@tanstack/react-query';
import type { InventoryItem, HubId } from '@/types';

async function fetchInventory(): Promise<InventoryItem[]> {
  const res = await fetch('/api/metabase/inventory');
  if (!res.ok) throw new Error('Failed to load inventory');
  return res.json();
}

export function useInventory() {
  return useQuery<InventoryItem[]>({
    queryKey: ['inventory'],
    queryFn: fetchInventory,
  });
}

export function useHubInventory(hubId: HubId) {
  const query = useInventory();
  return {
    ...query,
    data: query.data?.filter((item) => item.hubId === hubId) ?? [],
  };
}
