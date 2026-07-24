import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { isHead } from '@/constants/roles';
import { Sidebar } from '@/components/layout/Sidebar';
import { FilterBar } from '@/components/planning/FilterBar';
import { SkuPopupProvider } from '@/components/planning/SkuPopupProvider';
import { AdminRefreshButton } from '@/components/admin/AdminRefreshButton';
import { MAX_SKU_CHUNKS, SKU_CHUNK_PREFIX, decodeSkuChunks } from '@/lib/planning/filter';
import { fetchFilterPresets } from '@/lib/planning/source/filterPresets';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = await auth();
  const head = isHead(session?.user?.email ?? '');
  // The recorte = the hand-picked selection in the chunked vg:skus* cookies (the old
  // vg:filter top-bar filter was removed — filtering lives on the SKUs page).
  const skus = decodeSkuChunks(
    Array.from({ length: MAX_SKU_CHUNKS }, (_, i) => cookieStore.get(`${SKU_CHUNK_PREFIX}${i}`)?.value),
  );
  const presets = await fetchFilterPresets(); // cached (tag filter-presets), fail-open []

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <SkuPopupProvider>
          {/* key on the selection size → the chip re-seeds when it changes elsewhere. */}
          <div className="flex items-start justify-between gap-3">
            <FilterBar key={skus.length} initial={{ skus }} presets={presets} />
            {head && (
              <AdminRefreshButton
                href="/api/admin/refresh-cache?tag=forecast"
                idleLabel="Atualizar tabela de previsões"
                pendingLabel="Atualizando…"
                refreshOnDone
                doneLabel="Previsões atualizadas"
              />
            )}
          </div>
          {children}
        </SkuPopupProvider>
      </main>
    </div>
  );
}
