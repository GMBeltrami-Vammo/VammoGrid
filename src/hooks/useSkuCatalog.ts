'use client';

import { useQuery } from '@tanstack/react-query';

export interface SkuCatalogEntry {
  skuBase: string;
  skuName: string;
}

/** Full SKU catalog (code + name) for the search typeahead. Fetched lazily (only once
 *  the user actually types a query) and kept fresh for 10 min. */
export function useSkuCatalog(enabled: boolean) {
  return useQuery<SkuCatalogEntry[]>({
    queryKey: ['sku-catalog'],
    queryFn: async () => {
      const res = await fetch('/api/fleet/skus');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Erro ao carregar');
      return res.json();
    },
    staleTime: 600_000,
    enabled,
  });
}
