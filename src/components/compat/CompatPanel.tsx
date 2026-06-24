'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Trash2, Check, X, Minus } from 'lucide-react';
import { toSkuBase } from '@/lib/planning/sku';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompat } from '@/hooks/useCompat';
import { MODEL_LABELS } from '@/constants/models';
import { BIKE_MODELS } from '@/types';
import type { BikeModel, PartCompat } from '@/types';
import {
  upsertCompat,
  deleteCompat,
  type CompatInput,
} from '@/app/dashboard/compatibilidade/actions';

type Draft = CompatInput;

const emptyModels = (): Record<BikeModel, boolean> =>
  Object.fromEntries(BIKE_MODELS.map((m) => [m, false])) as Record<BikeModel, boolean>;

const emptyDraft = (): Draft => ({
  sku: '',
  description: '',
  partNumber: '',
  aplicacao: '',
  nacionalizado: false,
  models: emptyModels(),
});

const fromRow = (c: PartCompat): Draft => ({
  sku: c.sku,
  description: c.description ?? '',
  partNumber: c.partNumber ?? '',
  aplicacao: c.aplicacao ?? '',
  nacionalizado: c.nacionalizado,
  models: { ...c.models },
});

export function CompatPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data: rows, isLoading, isError } = useCompat();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter(
      (c) =>
        c.sku.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        (c.partNumber ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['part-compat'] });

  const startCreate = () => {
    setEditingSku(null);
    setDraft(emptyDraft());
    setCreating(true);
    setError(null);
  };
  const startEdit = (c: PartCompat) => {
    setCreating(false);
    setEditingSku(c.sku);
    setDraft(fromRow(c));
    setError(null);
  };
  const cancel = () => {
    setCreating(false);
    setEditingSku(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    if (!draft.sku.trim()) {
      setError('SKU é obrigatório.');
      return;
    }
    startTransition(async () => {
      try {
        await upsertCompat(draft);
        cancel();
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  const remove = (sku: string) => {
    if (!window.confirm(`Remover ${sku} da matriz?`)) return;
    startTransition(async () => {
      try {
        await deleteCompat(sku);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao remover.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar SKU, item ou part number…"
          />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} SKUs</p>
        {isHead && !creating && editingSku == null && (
          <Button size="sm" className="ml-auto" onClick={startCreate}>
            <Plus /> Adicionar SKU
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">
          {error}
        </p>
      )}

      {creating && (
        <CompatEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          title="Novo SKU"
          lockSku={false}
        />
      )}
      {editingSku && (
        <CompatEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          title={`Editar ${editingSku}`}
          lockSku
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar a matriz.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Matriz vazia.{' '}
          {isHead
            ? 'Adicione SKUs acima.'
            : 'Peça a um Head para popular a matriz.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Item</TableHead>
              {BIKE_MODELS.map((m) => (
                <TableHead key={m} className="text-center text-[11px]">
                  {MODEL_LABELS[m]}
                </TableHead>
              ))}
              <TableHead className="text-center">Nac.</TableHead>
              {isHead && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.sku}>
                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/dashboard/sku/${encodeURIComponent(toSkuBase(c.sku))}`}
                    className="text-foreground hover:text-brand-500 transition-colors"
                  >
                    {c.sku}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground">
                  {c.description ?? '—'}
                </TableCell>
                {BIKE_MODELS.map((m) => (
                  <TableCell key={m} className="text-center">
                    <BoolMark on={c.models[m]} />
                  </TableCell>
                ))}
                <TableCell className="text-center">
                  <BoolMark on={c.nacionalizado} />
                </TableCell>
                {isHead && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => startEdit(c)}
                        aria-label="Editar"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => remove(c.sku)}
                        aria-label="Remover"
                        disabled={pending}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function BoolMark({ on }: { on: boolean }) {
  return on ? (
    <Check className="mx-auto size-4 text-brand-500" />
  ) : (
    <Minus className="mx-auto size-3.5 text-muted-foreground/40" />
  );
}

function CompatEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
  title,
  lockSku,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  title: string;
  lockSku: boolean;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const toggleModel = (m: BikeModel) =>
    setDraft({ ...draft, models: { ...draft.models, [m]: !draft.models[m] } });

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-500">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            SKU *
          </span>
          <Input
            value={draft.sku}
            disabled={lockSku}
            onChange={(e) => set('sku', e.target.value)}
            placeholder="VM-01-FRE0-1010"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Item
          </span>
          <Input
            value={draft.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Part number
          </span>
          <Input
            value={draft.partNumber ?? ''}
            onChange={(e) => set('partNumber', e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Aplicação
          </span>
          <Input
            value={draft.aplicacao ?? ''}
            onChange={(e) => set('aplicacao', e.target.value)}
          />
        </label>
      </div>

      <p className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Modelos compatíveis
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {BIKE_MODELS.map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={draft.models[m]}
              onChange={() => toggleModel(m)}
              className="accent-brand-500"
            />
            {MODEL_LABELS[m]}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={draft.nacionalizado}
            onChange={(e) => set('nacionalizado', e.target.checked)}
            className="accent-brand-500"
          />
          Nacionalizado
        </label>
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
