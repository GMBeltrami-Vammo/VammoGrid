'use client';

import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { MAX_SELECTED_SKUS, type PlanningFilter } from '@/lib/planning/filter';
import { writeSkusCookies } from '@/lib/planning/applyFilter';
import { cn } from '@/lib/utils';

// Adds/removes this SKU from the app-wide hand-picked selection (vg:filter.skus)
// straight from the SKU detail page. The selection narrows every aggregate
// analysis (Estoque, Semanas, Compras, …). Syncs with the SKUs page + top bar
// via the shared cookie.
export function SkuFilterToggle({ skuBase, filter }: { skuBase: string; filter: PlanningFilter }) {
  const router = useRouter();
  const selected = filter.skus.includes(skuBase);
  const atCap = !selected && filter.skus.length >= MAX_SELECTED_SKUS;

  const toggle = () => {
    if (atCap) return;
    const skus = selected
      ? filter.skus.filter((s) => s !== skuBase)
      : [...filter.skus, skuBase];
    writeSkusCookies(skus);
    router.refresh();
  };

  return (
    <button
      onClick={toggle}
      disabled={atCap}
      title={atCap ? `Limite de ${MAX_SELECTED_SKUS} SKUs na seleção` : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        selected
          ? 'bg-brand-500/15 text-brand-600 hover:bg-brand-500/25'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
        atCap && 'cursor-not-allowed opacity-50',
      )}
    >
      {selected ? (
        <>
          <Check size={13} /> Na seleção global
        </>
      ) : (
        <>
          <Plus size={13} /> Adicionar à seleção
        </>
      )}
    </button>
  );
}
