'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
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
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { HUB_LIST, HUBS } from '@/constants/hubs';
import { cn } from '@/lib/utils';
import type { HubId, PurchaseOrder, PurchaseOrderStatus } from '@/types';
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderInput,
} from '@/app/dashboard/pedidos/actions';
import {
  MODAL_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_STYLES,
} from './orderMeta';

type Draft = PurchaseOrderInput;

const emptyDraft = (): Draft => ({
  vo: '',
  sku: '',
  skuName: '',
  qtyOrdered: 0,
  orderDate: new Date().toISOString().slice(0, 10),
  eta: '',
  leadTimeDays: null,
  status: 'ordered',
  modal: '',
  hubId: 'osasco',
  notes: '',
});

const fromOrder = (o: PurchaseOrder): Draft => ({
  vo: o.vo ?? '',
  sku: o.sku,
  skuName: o.skuName ?? '',
  qtyOrdered: o.qtyOrdered,
  orderDate: o.orderDate,
  eta: o.eta ?? '',
  leadTimeDays: o.leadTimeDays,
  status: o.status,
  modal: o.modal ?? '',
  hubId: o.hubId,
  notes: o.notes ?? '',
});

export function PurchaseOrdersPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data: orders, isLoading, isError } = usePurchaseOrders();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setCreating(true);
    setError(null);
  };

  const startEdit = (o: PurchaseOrder) => {
    setCreating(false);
    setEditingId(o.id);
    setDraft(fromOrder(o));
    setError(null);
  };

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
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
        if (editingId != null) {
          await updatePurchaseOrder(editingId, draft);
        } else {
          await createPurchaseOrder(draft);
        }
        cancel();
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('Remover este pedido?')) return;
    startTransition(async () => {
      try {
        await deletePurchaseOrder(id);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao remover.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {orders ? `${orders.length} pedidos` : '—'}
        </p>
        {isHead && !creating && editingId == null && (
          <Button size="sm" onClick={startCreate}>
            <Plus /> Adicionar pedido
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">
          {error}
        </p>
      )}

      {creating && (
        <OrderEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          title="Novo pedido"
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar pedidos.</p>
      ) : orders && orders.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>VO</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead>Pedido</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              {isHead && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) =>
              editingId === o.id ? (
                <TableRow key={o.id}>
                  <TableCell colSpan={isHead ? 10 : 9} className="p-0">
                    <OrderEditor
                      draft={draft}
                      setDraft={setDraft}
                      onSave={save}
                      onCancel={cancel}
                      pending={pending}
                      title={`Editar pedido #${o.id}`}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.vo ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link
                      prefetch={false}
                      href={`/dashboard/estoque?sku=${encodeURIComponent(toSkuBase(o.sku))}`}
                      className="text-brand-500 transition-colors hover:text-brand-400 hover:underline"
                    >
                      {o.sku}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {o.skuName ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.qtyOrdered}
                  </TableCell>
                  <TableCell className="tabular-nums">{o.orderDate}</TableCell>
                  <TableCell className="tabular-nums">{o.eta ?? '—'}</TableCell>
                  <TableCell>{HUBS[o.hubId]?.shortName ?? o.hubId}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">
                    {o.source}
                  </TableCell>
                  {isHead && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => startEdit(o)}
                          aria-label="Editar"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => remove(o.id)}
                          aria-label="Remover"
                          disabled={pending}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum pedido ainda. Os pedidos chegam via n8n (POST /api/orders/ingest)
          {isHead ? ' ou podem ser adicionados manualmente acima.' : '.'}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function OrderEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
  title,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  title: string;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-500">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="VO">
          <Input
            value={draft.vo ?? ''}
            onChange={(e) => set('vo', e.target.value)}
            placeholder="266"
          />
        </Field>
        <Field label="SKU *">
          <Input
            value={draft.sku}
            onChange={(e) => set('sku', e.target.value)}
            placeholder="VM-01-FRE0-1010"
          />
        </Field>
        <Field label="Item">
          <Input
            value={draft.skuName ?? ''}
            onChange={(e) => set('skuName', e.target.value)}
            placeholder="Descrição"
          />
        </Field>
        <Field label="Quantidade">
          <Input
            type="number"
            min={0}
            value={draft.qtyOrdered}
            onChange={(e) => set('qtyOrdered', Number(e.target.value))}
          />
        </Field>
        <Field label="Data do pedido">
          <Input
            type="date"
            value={draft.orderDate}
            onChange={(e) => set('orderDate', e.target.value)}
          />
        </Field>
        <Field label="ETA">
          <Input
            type="date"
            value={draft.eta ?? ''}
            onChange={(e) => set('eta', e.target.value)}
          />
        </Field>
        <Field label="Lead time (dias)">
          <Input
            type="number"
            min={0}
            value={draft.leadTimeDays ?? ''}
            onChange={(e) =>
              set('leadTimeDays', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Field>
        <Field label="Status">
          <NativeSelect
            value={draft.status ?? 'ordered'}
            onChange={(e) => set('status', e.target.value as PurchaseOrderStatus)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Modal">
          <NativeSelect
            value={draft.modal ?? ''}
            onChange={(e) => set('modal', e.target.value)}
          >
            <option value="">—</option>
            {Object.entries(MODAL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Base destino">
          <NativeSelect
            value={draft.hubId ?? 'osasco'}
            onChange={(e) => set('hubId', e.target.value as HubId)}
          >
            {HUB_LIST.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Notas" className="col-span-2">
          <Input
            value={draft.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
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

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NativeSelect(props: React.ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        'flex h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30',
        props.className,
      )}
    />
  );
}
