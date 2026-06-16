'use client';

import { useMemo } from 'react';
import { useInventory } from './useInventory';
import { usePurchaseOrders } from './usePurchaseOrders';
import { useSkuParams } from './useSkuParams';
import { projectAll } from '@/lib/projection';
import type { SkuParams, StockProjection } from '@/types';

// Combines live inventory + open purchase orders + per-SKU recovery params into
// a forward stock projection for every SKU. Pure client-side compute.
export function useProjections() {
  const inv = useInventory();
  const pos = usePurchaseOrders();
  const params = useSkuParams();

  const data = useMemo<StockProjection[]>(() => {
    if (!inv.data) return [];
    const map = new Map<string, SkuParams>(
      (params.data ?? []).map((p) => [p.sku, p]),
    );
    return projectAll(inv.data, pos.data ?? [], map);
  }, [inv.data, pos.data, params.data]);

  return {
    data,
    isLoading: inv.isLoading || pos.isLoading || params.isLoading,
    isError: inv.isError || pos.isError || params.isError,
  };
}
