'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SkuSupplier, Supplier } from '@/types';
import {
  linkSkuSupplier,
  setPreferredSupplier,
  setSupplierPartNumber,
  unlinkSkuSupplier,
} from '@/app/dashboard/fornecedores/actions';

// Per-SKU supplier links on the SKU cadastro (Estoque). Link/unlink suppliers, mark the
// preferred one (drives "pedido por fornecedor"), set priority. Read-only for non-Heads.

export function SupplierLinksPanel({
  skuBase,
  allSuppliers,
  links,
  isHead,
}: {
  skuBase: string;
  allSuppliers: Supplier[];
  links: SkuSupplier[];
  isHead: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [addId, setAddId] = useState('');

  const byId = new Map(allSuppliers.map((s) => [s.supplierId, s]));
  const linked = [...links].sort((a, b) => a.priority - b.priority);
  const linkedIds = new Set(links.map((l) => l.supplierId));
  const available = allSuppliers.filter((s) => s.active && !linkedIds.has(s.supplierId));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Erro.');
    });
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Fornecedores do SKU</p>

      {error && <p className="mt-2 rounded-md bg-alert-error/10 px-3 py-1.5 text-xs text-alert-error">{error}</p>}

      {linked.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum fornecedor vinculado.</p>
      ) : (
        <ul className="mt-2 divide-y divide-foreground/5">
          {linked.map((l) => {
            const s = byId.get(l.supplierId);
            return (
              <li key={l.supplierId} className="flex items-center gap-2 py-1.5 text-sm">
                {isHead ? (
                  <button
                    onClick={() =>
                      run(() => setPreferredSupplier(skuBase, l.isPreferred ? '' : l.supplierId, links.map((x) => x.supplierId)))
                    }
                    aria-label={l.isPreferred ? 'Preferido' : 'Marcar preferido'}
                    title={l.isPreferred ? 'Fornecedor preferido' : 'Marcar como preferido'}
                    className={cn(l.isPreferred ? 'text-[color:var(--color-alert-warning)]' : 'text-muted-foreground hover:text-foreground')}
                  >
                    <Star size={14} fill={l.isPreferred ? 'currentColor' : 'none'} />
                  </button>
                ) : (
                  l.isPreferred && <Star size={14} className="text-[color:var(--color-alert-warning)]" fill="currentColor" />
                )}
                <span className="font-medium">{s?.name ?? l.supplierId}</span>
                {s && (
                  <span className="text-[11px] text-muted-foreground">
                    {s.kind === 'nacional' ? 'Nacional' : 'Internacional'}
                  </span>
                )}
                {l.isPreferred && <span className="text-[11px] text-[color:var(--color-alert-warning)]">preferido</span>}
                <PartNumberField
                  value={l.supplierPartNumber}
                  isHead={isHead}
                  onSave={(pn) => run(() => setSupplierPartNumber(skuBase, l.supplierId, pn))}
                />
                {isHead && (
                  <button
                    onClick={() => run(() => unlinkSkuSupplier(skuBase, l.supplierId))}
                    aria-label="Desvincular"
                    className="ml-auto text-muted-foreground hover:text-alert-error"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isHead && available.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <select
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Vincular fornecedor…</option>
            {available.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.name} ({s.kind === 'nacional' ? 'Nac' : 'Intl'})
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!addId || pending}
            onClick={() =>
              run(async () => {
                const res = await linkSkuSupplier(skuBase, addId, { isPreferred: links.length === 0 });
                setAddId('');
                return res;
              })
            }
          >
            <Plus /> Vincular
          </Button>
        </div>
      )}
      {isHead && allSuppliers.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Nenhum fornecedor cadastrado. Crie em Fornecedores.
        </p>
      )}
    </div>
  );
}

// Inline supplier part-number field for a link: read-only chip for non-Heads; an input
// that saves on blur/Enter (only when changed) for Heads (Notas P3).
function PartNumberField({
  value,
  isHead,
  onSave,
}: {
  value: string | null;
  isHead: boolean;
  onSave: (partNumber: string | null) => void;
}) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  if (!isHead) {
    return value ? <span className="text-[11px] text-muted-foreground">P/N: {value}</span> : null;
  }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if ((v.trim() || null) !== (value ?? null)) onSave(v.trim() || null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      placeholder="P/N fornecedor"
      title="Part number do fornecedor para este SKU"
      className="h-6 w-32 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-brand-500 placeholder:text-muted-foreground/40"
    />
  );
}
