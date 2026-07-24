'use client';

import { useQuery } from '@tanstack/react-query';
import type { SkuSummary } from '@/lib/planning/skuSummary';

// Lazy-loads the SKU popup payload. `enabled` gates the fetch on the popup being open
// with a non-empty sku (mirrors useSkuCatalog). Keyed per sku so switching SKUs refetches.
export function useSkuSummary(skuBase: string | null, enabled: boolean) {
  return useQuery<SkuSummary>({
    queryKey: ['sku-summary', skuBase],
    enabled: enabled && !!skuBase,
    queryFn: async () => {
      const res = await fetch(`/api/fleet/sku-summary?sku=${encodeURIComponent(skuBase ?? '')}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 60_000,
  });
}
