'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Supplier, SupplierKind, SupplierModal } from '@/types';
import {
  createSupplier,
  deleteSupplier,
  deleteSupplierModal,
  updateSupplier,
  upsertSupplierModal,
  type SupplierInput,
} from '@/app/dashboard/fornecedores/actions';

// Supplier registry CRUD (review 4b). Server-rendered list + client edits; after each
// mutation router.refresh() re-runs the server component. SKU links are managed from
// the SKU cadastro (Estoque) — here we only show how many SKUs each supplies.

interface Draft {
  name: string;
  kind: SupplierKind;
  contact: string;
  notes: string;
  active: boolean;
}

const emptyDraft = (): Draft => ({
  name: '',
  kind: 'internacional',
  contact: '',
  notes: '',
  active: true,
});
const fromRow = (s: Supplier): Draft => ({
  name: s.name,
  kind: s.kind,
  contact: s.contact ?? '',
  notes: s.notes ?? '',
  active: s.active,
});
// Lead times são por modal agora (seção Modais) — o form não escreve mais os leads legados
// (leadTimeSea/Air undefined → preservados na edição, nulos na criação).
const toInput = (d: Draft): SupplierInput => ({
  name: d.name,
  kind: d.kind,
  contact: d.contact || null,
  notes: d.notes || null,
  active: d.active,
});

export function SuppliersManager({
  suppliers,
  skusBySupplier,
  skuNames = {},
  modalsBySupplier = {},
  isHead,
}: {
  suppliers: Supplier[];
  /** supplier_id → linked sku_bases (for the count + expandable list). */
  skusBySupplier: Record<string, string[]>;
  /** sku_base → display name, so the expanded list shows ID + nome. */
  skuNames?: Record<string, string>;
  /** supplier_id → its transport modals (Courier/Aéreo/Marítimo…). */
  modalsBySupplier?: Record<string, SupplierModal[]>;
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
        <SupplierEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          supplierId={editingId ?? undefined}
          modals={editingId ? modalsBySupplier[editingId] ?? [] : []}
          isHead={isHead}
          onModalsChanged={() => router.refresh()}
        />
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
                  {(modalsBySupplier[s.supplierId]?.length ?? 0) > 0 && (
                    <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600">
                      {modalsBySupplier[s.supplierId]!.length} modais
                    </span>
                  )}
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
                    <ModalsEditor
                      supplierId={s.supplierId}
                      modals={modalsBySupplier[s.supplierId] ?? []}
                      isHead={isHead}
                      onChanged={() => router.refresh()}
                    />
                    <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      SKUs abastecidos
                    </p>
                    {skus.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum SKU vinculado. Vincule no cadastro do SKU.</p>
                    ) : (
                      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                        {[...skus].sort().map((sku) => (
                          <li key={sku}>
                            <Link
                              prefetch={false}
                              href={`/dashboard/estoque?sku=${encodeURIComponent(sku)}`}
                              className="group inline-flex max-w-full items-baseline gap-1.5 py-0.5 text-[11px]"
                            >
                              <span className="shrink-0 font-mono text-brand-600 group-hover:underline">{sku}</span>
                              <span className="truncate text-muted-foreground" title={skuNames[sku]}>
                                {skuNames[sku] ?? '—'}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
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
  supplierId,
  modals = [],
  isHead = false,
  onModalsChanged,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  /** Present only when editing an existing supplier — enables the modais editor here. */
  supplierId?: string;
  modals?: SupplierModal[];
  isHead?: boolean;
  onModalsChanged?: () => void;
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

      {/* Modais (Courier/Aéreo/Marítimo…) — aqui mesmo no cadastro, ao editar. Os campos
          "Lead marítimo/aéreo" acima são o fallback legado (2 modais); use esta seção para
          cadastrar N modais com leads próprios (ex.: Courier 15). */}
      {supplierId ? (
        <div className="mt-4 border-t border-border/60 pt-3">
          <ModalsEditor supplierId={supplierId} modals={modals} isHead={isHead} onChanged={onModalsChanged ?? (() => {})} />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Salve o fornecedor para então cadastrar os modais (Courier, Aéreo, Marítimo…).
        </p>
      )}

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

// Transport modals per supplier (N modais: Courier/Aéreo/Marítimo…) — each with its
// own lead time. Feeds the SKU lead (fastest/slowest) + the Novo Pedido builder.
function ModalsEditor({
  supplierId,
  modals,
  isHead,
  onChanged,
}: {
  supplierId: string;
  modals: SupplierModal[];
  isHead: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [lead, setLead] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sorted = [...modals].sort((a, b) => b.leadDays - a.leadDays);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        onChanged();
      } else setError(res.error ?? 'Erro.');
    });
  };

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Modais</p>
      {error && <p className="mb-1 text-[11px] text-alert-error">{error}</p>}
      {sorted.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Nenhum modal cadastrado — usando o lead marítimo/aéreo legado como fallback.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {sorted.map((m) => (
            <li
              key={m.modalId}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px]"
            >
              <span className="font-medium">{m.name}</span>
              <span className="tabular-nums text-muted-foreground">{m.leadDays}d</span>
              {isHead && (
                <button
                  onClick={() => run(() => deleteSupplierModal(supplierId, m.modalId))}
                  disabled={pending}
                  aria-label={`Remover ${m.name}`}
                  className="text-muted-foreground hover:text-alert-error"
                >
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isHead && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Modal (ex.: Courier)"
            className="h-7 w-36 text-xs"
          />
          <Input
            type="number"
            min={1}
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            placeholder="lead (d)"
            className="h-7 w-24 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !name.trim() || !(Number(lead) > 0)}
            onClick={() =>
              run(
                () => upsertSupplierModal(supplierId, { name: name.trim(), leadDays: Number(lead) }),
                () => {
                  setName('');
                  setLead('');
                },
              )
            }
          >
            <Plus /> Adicionar modal
          </Button>
        </div>
      )}
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
