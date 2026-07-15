'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Supplier, SupplierKind } from '@/types';
import { createSupplier, deleteSupplier, updateSupplier, type SupplierInput } from '@/app/dashboard/fornecedores/actions';

// Supplier registry CRUD (review 4b). Server-rendered list + client edits; after each
// mutation router.refresh() re-runs the server component. SKU links are managed from
// the SKU cadastro (Estoque) — here we only show how many SKUs each supplies.

interface Draft {
  name: string;
  kind: SupplierKind;
  contact: string;
  notes: string;
  seaDays: string;
  airDays: string;
  active: boolean;
}

const emptyDraft = (): Draft => ({
  name: '',
  kind: 'internacional',
  contact: '',
  notes: '',
  seaDays: '',
  airDays: '',
  active: true,
});
const fromRow = (s: Supplier): Draft => ({
  name: s.name,
  kind: s.kind,
  contact: s.contact ?? '',
  notes: s.notes ?? '',
  seaDays: s.leadTimeSeaDays != null ? String(s.leadTimeSeaDays) : '',
  airDays: s.leadTimeAirDays != null ? String(s.leadTimeAirDays) : '',
  active: s.active,
});
const toInput = (d: Draft): SupplierInput => ({
  name: d.name,
  kind: d.kind,
  contact: d.contact || null,
  notes: d.notes || null,
  leadTimeSeaDays: d.seaDays.trim() === '' ? null : Number(d.seaDays),
  leadTimeAirDays: d.airDays.trim() === '' ? null : Number(d.airDays),
  active: d.active,
});

export function SuppliersManager({
  suppliers,
  skusBySupplier,
  isHead,
}: {
  suppliers: Supplier[];
  /** supplier_id → linked sku_bases (for the count + expandable list). */
  skusBySupplier: Record<string, string[]>;
  isHead: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    startTransition(async () => {
      const res = editingId ? await updateSupplier(editingId, toInput(draft)) : await createSupplier(toInput(draft));
      if (res.ok) {
        cancel();
        router.refresh();
      } else {
        setError(res.error ?? 'Erro ao salvar.');
      }
    });
  };

  const remove = (s: Supplier) => {
    if (!window.confirm(`Remover fornecedor "${s.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteSupplier(s.supplierId);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Erro ao remover.');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{suppliers.length} fornecedores</p>
        {isHead && !creating && editingId == null && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(emptyDraft());
              setCreating(true);
            }}
          >
            <Plus /> Novo fornecedor
          </Button>
        )}
      </div>

      {error && <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>}

      {(creating || editingId) && (
        <SupplierEditor draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} pending={pending} />
      )}

      {suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum fornecedor.{isHead ? ' Adicione o primeiro acima.' : ''}
        </p>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => {
            const skus = skusBySupplier[s.supplierId] ?? [];
            const open = expanded === s.supplierId;
            return (
              <div key={s.supplierId} className="rounded-xl bg-card ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="font-medium">{s.name}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      s.kind === 'nacional' ? 'bg-brand-500/15 text-brand-600' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {s.kind === 'nacional' ? 'Nacional' : 'Internacional'}
                  </span>
                  {!s.active && <span className="text-[11px] text-muted-foreground">inativo</span>}
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    lead {s.leadTimeSeaDays ?? '—'}d mar / {s.leadTimeAirDays ?? '—'}d aéreo
                  </span>
                  {s.contact && <span className="text-xs text-muted-foreground">{s.contact}</span>}
                  <button
                    onClick={() => setExpanded(open ? null : s.supplierId)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {skus.length} SKU{skus.length === 1 ? '' : 's'}
                  </button>
                  {isHead && (
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Editar"
                        onClick={() => {
                          setCreating(false);
                          setEditingId(s.supplierId);
                          setDraft(fromRow(s));
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Remover" disabled={pending} onClick={() => remove(s)}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                {open && (
                  <div className="border-t border-border/60 px-4 py-2">
                    {s.notes && <p className="mb-2 text-xs text-muted-foreground">{s.notes}</p>}
                    {skus.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum SKU vinculado. Vincule no cadastro do SKU.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {skus.map((sku) => (
                          <Link
                            key={sku}
                            prefetch={false}
                            href={`/dashboard/estoque?sku=${encodeURIComponent(sku)}`}
                            className="rounded bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-brand-600 hover:bg-muted"
                          >
                            {sku}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SupplierEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Labeled label="Nome">
          <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Fornecedor" />
        </Labeled>
        <Labeled label="Tipo">
          <div className="flex h-8 gap-0.5 rounded-md bg-muted/60 p-0.5">
            {(['internacional', 'nacional'] as SupplierKind[]).map((k) => (
              <button
                key={k}
                onClick={() => set('kind', k)}
                className={cn(
                  'flex-1 rounded px-2 text-[11px] font-medium transition-colors',
                  draft.kind === k ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {k === 'internacional' ? 'Internacional' : 'Nacional'}
              </button>
            ))}
          </div>
        </Labeled>
        <Labeled label="Contato">
          <Input value={draft.contact} onChange={(e) => set('contact', e.target.value)} placeholder="e-mail / telefone" />
        </Labeled>
        <Labeled label="Lead marítimo (d)">
          <Input
            type="number"
            min={0}
            value={draft.seaDays}
            onChange={(e) => set('seaDays', e.target.value)}
            placeholder="105"
          />
        </Labeled>
        <Labeled label="Lead aéreo (d)">
          <Input
            type="number"
            min={0}
            value={draft.airDays}
            onChange={(e) => set('airDays', e.target.value)}
            placeholder="45"
          />
        </Labeled>
        <Labeled label="Ativo">
          <div className="flex h-8 gap-0.5 rounded-md bg-muted/60 p-0.5">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                onClick={() => set('active', v)}
                className={cn(
                  'flex-1 rounded px-2 text-[11px] font-medium transition-colors',
                  draft.active === v ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v ? 'Sim' : 'Não'}
              </button>
            ))}
          </div>
        </Labeled>
        <Labeled label="Notas" className="lg:col-span-4">
          <Input value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Observações" />
        </Labeled>
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={onSave} disabled={pending}>
          <Check /> {pending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          <X /> Cancelar
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
