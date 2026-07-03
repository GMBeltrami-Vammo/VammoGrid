'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bike, X, TrendingUp } from 'lucide-react';
import { MODEL_LABELS } from '@/constants/models';
import { BIKE_MODELS } from '@/types';
import { type PlanningFilter } from '@/lib/planning/filter';
import { writeFilterCookie, writeSkusCookies } from '@/lib/planning/applyFilter';
import { useSkuCatalog } from '@/hooks/useSkuCatalog';
import { cn } from '@/lib/utils';

// App-wide filter bar. Writes the `vg:filter` cookie and refreshes so the server
// re-renders the narrowed dataset. Bike models come from part_compat; category is
// the coarse warehouse class.

const CATEGORIES: { v: string | null; label: string }[] = [
  { v: null, label: 'Tudo' },
  { v: 'BIKE', label: 'Moto' },
  { v: 'BATTERY', label: 'Bateria' },
];

export function FilterBar({ initial }: { initial: PlanningFilter }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState<string | null>(initial.category);
  const [models, setModels] = useState<string[]>(initial.models);
  const [open, setOpen] = useState(false);

  // Search typeahead: typing shows clickable SKU matches that navigate straight to the
  // SKU page (Enter still applies the text filter to the analyses, as before). The
  // catalog is fetched lazily on the first real query and cached client-side.
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

  const [withForecast, setWithForecast] = useState(initial.withForecast);

  // The hand-picked SKU selection is managed on the SKUs page; the bar preserves it
  // across category/model/search edits and offers a one-click clear.
  const skus = initial.skus;

  // The hand-picked selection lives in its own chunked cookies — edits here don't touch
  // it (it's preserved automatically).
  function apply(next: Pick<PlanningFilter, 'models' | 'category' | 'q'>, wf = withForecast) {
    writeFilterCookie({ ...next, skus, withForecast: wf });
    router.refresh();
  }
  const setCat = (v: string | null) => {
    setCategory(v);
    apply({ models, category: v, q });
  };
  const toggleModel = (m: string) => {
    const next = models.includes(m) ? models.filter((x) => x !== m) : [...models, m];
    setModels(next);
    apply({ models: next, category, q });
  };
  const toggleWithForecast = () => {
    const next = !withForecast;
    setWithForecast(next);
    apply({ models, category, q }, next);
  };
  const clearAll = () => {
    setQ('');
    setCategory(null);
    setModels([]);
    setWithForecast(false);
    // "Limpar filtro" clears everything, including the hand-picked selection.
    writeFilterCookie({ models: [], category: null, q: '', skus: [], withForecast: false });
    writeSkusCookies([]);
    router.refresh();
  };
  const clearSelection = () => {
    writeSkusCookies([]);
    router.refresh();
  };

  const active =
    models.length > 0 || category != null || q.trim().length > 0 || skus.length > 0 || withForecast;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearchOpen(false);
          apply({ models, category, q });
        }}
        className="relative"
      >
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
          }}
          placeholder="Buscar SKU ou descrição…"
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
                Clique para abrir o SKU · Enter filtra as análises
              </p>
            </div>
          </>
        )}
      </form>

      <div className="flex gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            onClick={() => setCat(c.v)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              category === c.v ? 'bg-brand-500/15 text-brand-600' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            models.length > 0 ? 'bg-brand-500/15 text-brand-600' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <Bike size={14} /> Modelos{models.length > 0 ? ` (${models.length})` : ''}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 w-56 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-foreground/10">
              {BIKE_MODELS.map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={models.includes(m)}
                    onChange={() => toggleModel(m)}
                    className="accent-brand-500"
                  />
                  {MODEL_LABELS[m]}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        onClick={toggleWithForecast}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          withForecast ? 'bg-brand-500/15 text-brand-600' : 'text-muted-foreground hover:bg-muted',
        )}
        title="Mostrar apenas SKUs com previsão de demanda (S&OP)"
      >
        <TrendingUp size={14} /> Com previsão
      </button>

      {skus.length > 0 && (
        <span className="flex items-center gap-1.5 rounded-md bg-brand-500/15 px-2.5 py-1.5 text-xs font-medium text-brand-600">
          {skus.length} SKU{skus.length > 1 ? 's' : ''} selecionado{skus.length > 1 ? 's' : ''}
          <button
            onClick={clearSelection}
            aria-label="Limpar seleção de SKUs"
            className="rounded p-0.5 hover:bg-brand-500/20"
          >
            <X size={12} />
          </button>
        </span>
      )}

      {active && (
        <button
          onClick={clearAll}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X size={12} /> Limpar filtro
        </button>
      )}
    </div>
  );
}
