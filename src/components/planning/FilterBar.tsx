'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bike, X } from 'lucide-react';
import { MODEL_LABELS } from '@/constants/models';
import { BIKE_MODELS } from '@/types';
import { FILTER_COOKIE, type PlanningFilter } from '@/lib/planning/filter';
import { cn } from '@/lib/utils';

// App-wide filter bar. Writes the `vg:filter` cookie and refreshes so the server
// re-renders the narrowed dataset. Bike models come from part_compat; category is
// the coarse warehouse class.

const CATEGORIES: { v: string | null; label: string }[] = [
  { v: null, label: 'Tudo' },
  { v: 'BIKE', label: 'Moto' },
  { v: 'BATTERY', label: 'Bateria' },
  { v: 'BOX', label: 'Baú' },
];

export function FilterBar({ initial }: { initial: PlanningFilter }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState<string | null>(initial.category);
  const [models, setModels] = useState<string[]>(initial.models);
  const [open, setOpen] = useState(false);

  function apply(next: PlanningFilter) {
    // eslint-disable-next-line react-hooks/immutability -- event-handler side effect, not a render mutation
    document.cookie = `${FILTER_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000`;
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
  const clearAll = () => {
    setQ('');
    setCategory(null);
    setModels([]);
    apply({ models: [], category: null, q: '' });
  };

  const active = models.length > 0 || category != null || q.trim().length > 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ models, category, q });
        }}
        className="relative"
      >
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar SKU ou descrição…"
          className="h-8 w-56 rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-brand-500"
        />
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
