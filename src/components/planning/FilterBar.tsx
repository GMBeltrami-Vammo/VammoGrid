'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { MAX_SELECTED_SKUS, type PlanningFilter } from '@/lib/planning/filter';
import { writeSkusCookies } from '@/lib/planning/applyFilter';
import { useSkuCatalog } from '@/hooks/useSkuCatalog';
import type { FilterPreset } from '@/types';

// Slim top bar: (a) SKU search as pure NAVIGATION (typeahead → SKU page; it does not
// filter anything) and (b) the global "N SKUs selecionados" chip. All FILTERING lives
// on the SKUs page — the hand-picked selection there is the single recorte the
// analyses see (the old top-bar model/category/forecast filters were removed).

export function FilterBar({ initial, presets = [] }: { initial: PlanningFilter; presets?: FilterPreset[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.presetId === id);
    if (!p) return;
    writeSkusCookies(p.skus.slice(0, MAX_SELECTED_SKUS));
    router.refresh();
  };

  // Search typeahead: clickable SKU matches that navigate straight to the SKU page.
  const [searchOpen, setSearchOpen] = useState(false);
  const wantsSearch = q.trim().length >= 2;
  const { data: catalog } = useSkuCatalog(wantsSearch);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2 || !catalog) return [];
    return catalog
      .filter((s) => s.skuBase.toLowerCase().includes(n) || s.skuName.toLowerCase().includes(n))
      .slice(0, 8);
  }, [catalog, q]);

  const goToSku = (skuBase: string) => {
    setSearchOpen(false);
    router.push(`/dashboard/estoque?sku=${encodeURIComponent(skuBase)}`);
  };

  const clearSelection = () => {
    writeSkusCookies([]);
    router.refresh();
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearchOpen(false);
            if (e.key === 'Enter' && matches.length > 0) goToSku(matches[0].skuBase);
          }}
          placeholder="Buscar SKU…"
          className="h-8 w-56 rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-brand-500"
        />
        {searchOpen && wantsSearch && matches.length > 0 && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSearchOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-foreground/10">
              {matches.map((m) => (
                <button
                  key={m.skuBase}
                  type="button"
                  onClick={() => goToSku(m.skuBase)}
                  className="flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left hover:bg-muted"
                >
                  <span className="max-w-full truncate text-sm text-foreground">{m.skuName}</span>
                  <span className="font-mono text-[11px] text-brand-500">{m.skuBase}</span>
                </button>
              ))}
              <p className="border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">
                Clique (ou Enter) para abrir o SKU
              </p>
            </div>
          </>
        )}
      </div>

      {presets.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && applyPreset(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500"
          title="Aplicar um preset de seleção (recorte das análises)"
        >
          <option value="">Preset…</option>
          {presets.map((p) => (
            <option key={p.presetId} value={p.presetId}>
              {p.name} ({p.skus.length})
            </option>
          ))}
        </select>
      )}

      {initial.skus.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-medium text-brand-600">
          {initial.skus.length} SKU{initial.skus.length > 1 ? 's' : ''} selecionado{initial.skus.length > 1 ? 's' : ''} — análises focadas
          <button onClick={clearSelection} aria-label="Limpar seleção" className="hover:text-brand-500">
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  );
}
