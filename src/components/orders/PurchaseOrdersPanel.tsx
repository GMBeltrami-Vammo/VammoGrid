'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronRight, Plus, Trash2, Check, X } from 'lucide-react';
import { toSkuBase } from '@/lib/planning/sku';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { HUB_LIST, HUBS } from '@/constants/hubs';
import { fmtDate } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import { DateField } from '@/components/ui/DateField';
import type { HubId, PurchaseOrder, PurchaseOrderStatus } from '@/types';
import {
  createPurchaseOrder,
  deletePedido,
  deletePurchaseOrder,
  updateOrderLine,
  updatePedidoHeader,
} from '@/app/dashboard/pedidos/actions';
import { MODAL_LABELS, STATUS_LABELS, STATUS_ORDER, STATUS_STYLES, lifecycleLabel, sourceLabel } from './orderMeta';

// Pedidos are edited at the PEDIDO level (request #1): each group (one VO) has its own
// status / ETA / order-date (VO read-only) applied to all lines at once, plus an
// expandable dropdown of editable SKU lines (sku / item / qty) — no per-line ETA/status.

interface PedidoGroup {
  key: string;
  vo: string | null;
  lines: PurchaseOrder[];
  status: PurchaseOrderStatus;
  orderDate: string;
  eta: string | null;
  modal: string | null;
  hubId: HubId;
  source: string;
  prepStatus: PurchaseOrder['prepStatus'];
}

function groupByVo(orders: PurchaseOrder[]): PedidoGroup[] {
  const map = new Map<string, PurchaseOrder[]>();
  for (const o of orders) {
    const key = o.vo ? `vo:${o.vo}` : `id:${o.id}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(o);
  }
  const groups: PedidoGroup[] = [];
  for (const [key, lines] of map) {
    const h = lines[0];
    groups.push({
      key,
      vo: h.vo,
      lines,
      status: h.status,
      orderDate: h.orderDate,
      eta: h.eta,
      modal: h.modal,
      hubId: h.hubId,
      source: h.source,
      prepStatus: h.prepStatus,
    });
  }
  // Newest order-date first.
  return groups.sort((a, b) => (a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : 0));
}

export function PurchaseOrdersPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data: orders, isLoading, isError } = usePurchaseOrders();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  const groups = useMemo(() => (orders ? groupByVo(orders) : []), [orders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{orders ? `${groups.length} pedidos` : '—'}</p>
        {isHead && !creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Novo pedido
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">{error}</p>
      )}

      {creating && (
        <NewPedidoForm
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
          onError={setError}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar pedidos.</p>
      ) : groups.length > 0 ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <PedidoGroupCard key={g.key} group={g} isHead={isHead} onChanged={refresh} onError={setError} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum pedido ainda. Sincronizados do ClickHouse{isHead ? ' ou adicione acima.' : '.'}
        </p>
      )}
    </div>
  );
}

function PedidoGroupCard({
  group,
  isHead,
  onChanged,
  onError,
}: {
  group: PedidoGroup;
  isHead: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PurchaseOrderStatus>(group.status);
  const [orderDate, setOrderDate] = useState(group.orderDate);
  const [eta, setEta] = useState(group.eta ?? '');
  const [pending, startTransition] = useTransition();
  const [addingLine, setAddingLine] = useState(false);

  const ids = group.lines.map((l) => l.id);
  const totalQty = group.lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const headerDirty = status !== group.status || orderDate !== group.orderDate || (eta || '') !== (group.eta ?? '');

  const saveHeader = () => {
    onError(null);
    startTransition(async () => {
      const res = await updatePedidoHeader(ids, { status, orderDate, eta: eta || null });
      if (res.ok) onChanged();
      else onError(res.error ?? 'Erro ao salvar pedido.');
    });
  };

  const removePedido = () => {
    if (!window.confirm(`Excluir o pedido ${group.vo ?? ''} e suas ${group.lines.length} linha(s)?`)) return;
    onError(null);
    startTransition(async () => {
      const res = await deletePedido(ids);
      if (res.ok) onChanged();
      else onError(res.error ?? 'Erro ao excluir pedido.');
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground" aria-label="Expandir">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="min-w-[7rem]">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">VO</span>
          <Link
            prefetch={false}
            href={`/dashboard/pedidos/${encodeURIComponent(group.vo ?? group.lines[0].id)}`}
            className="block font-medium text-brand-500 hover:text-brand-400 hover:underline"
          >
            {group.vo ?? 'manual'}
          </Link>
        </div>

        <HeaderField label="Data do pedido">
          {isHead ? (
            <DateField value={orderDate} onChange={setOrderDate} className="h-8 w-36" aria-label="Data do pedido" />
          ) : (
            <span className="text-sm tabular-nums">{fmtDate(group.orderDate)}</span>
          )}
        </HeaderField>

        <HeaderField label="ETA">
          {isHead ? (
            <DateField value={eta} onChange={setEta} className="h-8 w-36" aria-label="ETA" />
          ) : (
            <span className="text-sm tabular-nums">{fmtDate(group.eta)}</span>
          )}
        </HeaderField>

        <HeaderField label="Status">
          {isHead ? (
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </NativeSelect>
          ) : (
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_STYLES[group.status])}>
              {lifecycleLabel(group.prepStatus, group.status)}
            </span>
          )}
        </HeaderField>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{group.lines.length} SKUs · {totalQty} un.</span>
          <span>{sourceLabel(group.source)}</span>
          {isHead && (
            <>
              <Button size="sm" onClick={saveHeader} disabled={!headerDirty || pending}>
                <Check /> {pending ? '…' : 'Salvar'}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={removePedido}
                disabled={pending}
                aria-label="Excluir pedido"
                className="text-muted-foreground hover:text-alert-error"
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Lines dropdown */}
      {open && (
        <div className="border-t border-border px-3 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 font-medium">SKU</th>
                <th className="py-1 font-medium">Item</th>
                <th className="py-1 text-right font-medium">Qtd</th>
                {isHead && <th className="py-1" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {group.lines.map((l) => (
                <LineRow key={l.id} line={l} isHead={isHead} onChanged={onChanged} onError={onError} />
              ))}
            </tbody>
          </table>

          {isHead &&
            (addingLine ? (
              <AddLineForm
                group={group}
                onDone={() => {
                  setAddingLine(false);
                  onChanged();
                }}
                onCancel={() => setAddingLine(false)}
                onError={onError}
              />
            ) : (
              <button
                onClick={() => setAddingLine(true)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500"
              >
                <Plus size={13} /> Adicionar SKU
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function LineRow({
  line,
  isHead,
  onChanged,
  onError,
}: {
  line: PurchaseOrder;
  isHead: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sku, setSku] = useState(line.sku);
  const [skuName, setSkuName] = useState(line.skuName ?? '');
  const [qty, setQty] = useState(line.qtyOrdered);
  const [pending, startTransition] = useTransition();

  const save = () => {
    onError(null);
    startTransition(async () => {
      const res = await updateOrderLine(line.id, { sku, skuName, qtyOrdered: qty });
      if (res.ok) {
        setEditing(false);
        onChanged();
      } else onError(res.error ?? 'Erro ao salvar linha.');
    });
  };

  const remove = () => {
    if (!window.confirm('Remover esta linha do pedido?')) return;
    startTransition(async () => {
      try {
        await deletePurchaseOrder(line.id);
        onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Erro ao remover.');
      }
    });
  };

  if (editing) {
    return (
      <tr>
        <td className="py-1 pr-2">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} className="h-8 font-mono text-xs" />
        </td>
        <td className="py-1 pr-2">
          <Input value={skuName} onChange={(e) => setSkuName(e.target.value)} className="h-8" />
        </td>
        <td className="py-1">
          <Input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-8 w-20 text-right tabular-nums" />
        </td>
        <td className="py-1 text-right">
          <div className="flex justify-end gap-1">
            <Button size="icon-sm" variant="ghost" onClick={save} disabled={pending} aria-label="Salvar"><Check /></Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending} aria-label="Cancelar"><X /></Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-muted/20">
      <td className="py-1.5 font-mono text-xs">
        <Link
          prefetch={false}
          href={`/dashboard/estoque?sku=${encodeURIComponent(toSkuBase(line.sku))}`}
          className="text-brand-500 hover:text-brand-400"
        >
          {line.sku}
        </Link>
      </td>
      <td className="max-w-[240px] truncate py-1.5 text-muted-foreground">{line.skuName ?? '—'}</td>
      <td className="py-1.5 text-right tabular-nums">{line.qtyOrdered}</td>
      {isHead && (
        <td className="py-1.5 text-right">
          <div className="flex justify-end gap-1">
            <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:text-brand-500">Editar</button>
            <button onClick={remove} disabled={pending} aria-label="Remover" className="text-muted-foreground hover:text-alert-error">
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddLineForm({
  group,
  onDone,
  onCancel,
  onError,
}: {
  group: PedidoGroup;
  onDone: () => void;
  onCancel: () => void;
  onError: (m: string | null) => void;
}) {
  const [sku, setSku] = useState('');
  const [skuName, setSkuName] = useState('');
  const [qty, setQty] = useState(0);
  const [pending, startTransition] = useTransition();

  const add = () => {
    onError(null);
    if (!sku.trim()) return onError('SKU é obrigatório.');
    startTransition(async () => {
      try {
        // New line inherits the pedido's header (vo/status/eta/date/modal/hub).
        await createPurchaseOrder({
          vo: group.vo,
          sku,
          skuName,
          qtyOrdered: qty,
          orderDate: group.orderDate,
          eta: group.eta,
          status: group.status,
          modal: group.modal,
          hubId: group.hubId,
        });
        onDone();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Erro ao adicionar.');
      }
    });
  };

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/30 p-2">
      <Field label="SKU"><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VM-01-…" className="h-8 w-40 font-mono text-xs" /></Field>
      <Field label="Item"><Input value={skuName} onChange={(e) => setSkuName(e.target.value)} className="h-8 w-48" /></Field>
      <Field label="Qtd"><Input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-8 w-20 text-right tabular-nums" /></Field>
      <Button size="sm" onClick={add} disabled={pending}><Check /> {pending ? '…' : 'Adicionar'}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}><X /> Cancelar</Button>
    </div>
  );
}

function NewPedidoForm({
  onDone,
  onCancel,
  onError,
}: {
  onDone: () => void;
  onCancel: () => void;
  onError: (m: string | null) => void;
}) {
  const [vo, setVo] = useState('');
  const [sku, setSku] = useState('');
  const [skuName, setSkuName] = useState('');
  const [qty, setQty] = useState(0);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [eta, setEta] = useState('');
  const [modal, setModal] = useState('');
  const [hubId, setHubId] = useState<HubId>('osasco');
  const [pending, startTransition] = useTransition();

  const save = () => {
    onError(null);
    if (!sku.trim()) return onError('SKU é obrigatório.');
    startTransition(async () => {
      try {
        await createPurchaseOrder({
          vo: vo || null,
          sku,
          skuName,
          qtyOrdered: qty,
          orderDate,
          eta: eta || null,
          status: 'ordered',
          modal: modal || null,
          hubId,
        });
        onDone();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand-500">Novo pedido</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="VO"><Input value={vo} onChange={(e) => setVo(e.target.value)} placeholder="266" /></Field>
        <Field label="Data do pedido"><DateField value={orderDate} onChange={setOrderDate} /></Field>
        <Field label="ETA"><DateField value={eta} onChange={setEta} /></Field>
        <Field label="Modal">
          <NativeSelect value={modal} onChange={(e) => setModal(e.target.value)}>
            <option value="">—</option>
            {Object.entries(MODAL_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </NativeSelect>
        </Field>
        <Field label="Base destino">
          <NativeSelect value={hubId} onChange={(e) => setHubId(e.target.value as HubId)}>
            {HUB_LIST.map((h) => (<option key={h.id} value={h.id}>{HUBS[h.id]?.shortName ?? h.name}</option>))}
          </NativeSelect>
        </Field>
        <Field label="SKU (1ª linha) *"><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VM-01-FRE0-1010" className="font-mono text-xs" /></Field>
        <Field label="Item"><Input value={skuName} onChange={(e) => setSkuName(e.target.value)} /></Field>
        <Field label="Quantidade"><Input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}><Check /> {pending ? 'Salvando…' : 'Criar'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}><X /> Cancelar</Button>
      </div>
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">{label}</span>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
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
