import { cookies } from 'next/headers';
import { Sidebar } from '@/components/layout/Sidebar';
import { FilterBar } from '@/components/planning/FilterBar';
import {
  FILTER_COOKIE,
  MAX_SKU_CHUNKS,
  SKU_CHUNK_PREFIX,
  decodeSkuChunks,
  parseFilterCookie,
} from '@/lib/planning/filter';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const filter = {
    ...parseFilterCookie(cookieStore.get(FILTER_COOKIE)?.value),
    // The selection lives in the chunked vg:skus* cookies — merge it so the bar's
    // "N selecionados" chip is accurate.
    skus: decodeSkuChunks(
      Array.from({ length: MAX_SKU_CHUNKS }, (_, i) => cookieStore.get(`${SKU_CHUNK_PREFIX}${i}`)?.value),
    ),
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {/* key tied to the filter → remounts (re-seeds its local state) whenever the
            shared cookie changes, so the bar reflects edits made from other controls
            (e.g. the category chips on the SKUs page). */}
        <FilterBar
          key={`${filter.category ?? ''}|${filter.models.join(',')}|${filter.q}|${filter.withForecast}|${filter.skus.length}`}
          initial={filter}
        />
        {children}
      </main>
    </div>
  );
}
