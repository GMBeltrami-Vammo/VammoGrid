'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useSession } from 'next-auth/react';

// ---------------------------------------------------------------------------
// Global SKU filter — persisted in localStorage, keyed by the user's email.
//
// Model: we store the set of EXCLUDED skuIds. Everything not in the set is
// shown. This means new SKUs (that appear later from Metabase) are visible by
// default, and only explicit deselections are remembered.
//
// localStorage was chosen (per product decision) over server-side: the filter
// persists per browser/device, scoped to the logged-in user's email so two
// @vammo people sharing a machine don't clobber each other.
// ---------------------------------------------------------------------------

interface FilterContextValue {
  excluded: Set<string>;
  isIncluded: (skuId: string) => boolean;
  toggle: (skuId: string) => void;
  setIncluded: (skuId: string, included: boolean) => void;
  selectAll: () => void;
  clearAll: (allSkuIds: string[]) => void;
  excludedCount: number;
  /** true once the initial localStorage read has completed (avoids SSR flash) */
  ready: boolean;
}

const FilterContext = createContext<FilterContextValue | null>(null);

const keyFor = (email?: string | null) => `vammogrid:skuFilter:${email ?? 'anon'}`;

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const email = session?.user?.email ?? null;

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  // Load whenever the active user changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(keyFor(email));
      setExcluded(raw ? new Set<string>(JSON.parse(raw)) : new Set());
    } catch {
      setExcluded(new Set());
    }
    setReady(true);
  }, [email]);

  const persist = useCallback(
    (next: Set<string>) => {
      setExcluded(next);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(keyFor(email), JSON.stringify([...next]));
        } catch {
          /* quota / private mode — keep in-memory only */
        }
      }
    },
    [email],
  );

  const value = useMemo<FilterContextValue>(
    () => ({
      excluded,
      isIncluded: (skuId) => !excluded.has(skuId),
      toggle: (skuId) => {
        const next = new Set(excluded);
        if (next.has(skuId)) next.delete(skuId);
        else next.add(skuId);
        persist(next);
      },
      setIncluded: (skuId, included) => {
        const next = new Set(excluded);
        if (included) next.delete(skuId);
        else next.add(skuId);
        persist(next);
      },
      selectAll: () => persist(new Set()),
      clearAll: (allSkuIds) => persist(new Set(allSkuIds)),
      excludedCount: excluded.size,
      ready,
    }),
    [excluded, ready, persist],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useSkuFilter(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useSkuFilter must be used within FilterProvider');
  return ctx;
}

/** Remove globally-excluded SKUs from any list of items keyed by skuId. */
export function useApplyFilter<T extends { skuId: string }>(items: T[]): T[] {
  const { excluded } = useSkuFilter();
  return useMemo(
    () => items.filter((i) => !excluded.has(i.skuId)),
    [items, excluded],
  );
}
