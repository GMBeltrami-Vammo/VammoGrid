'use client';

import { FilterTable } from '@/components/inventory/FilterTable';

// Filtragem now lives as a tab inside Visão Geral (/dashboard). This route is
// kept as a thin alias so existing links/bookmarks still work.
export default function FiltragemPage() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Filtragem</h1>
      <FilterTable />
    </div>
  );
}
