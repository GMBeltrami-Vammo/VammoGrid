import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { fetchOrderRows } from '@/lib/planning/source/orders';
import { mapPurchaseOrderRow } from '@/lib/clickhouse/mappers';
import { readAuditLog } from '@/lib/clickhouse/fleet';
import { toSkuBase } from '@/lib/planning/sku';
import { fmtDate, fmtInt } from '@/lib/planning/format';
import { EmptyState, PageHeader } from '@/components/planning/ui';
import { PrepStatusControl } from '@/components/orders/PrepStatusControl';
import { DeletePedidoButton } from '@/components/orders/DeletePedidoButton';
import {
  MODAL_LABELS,
  ORDER_TYPE_LABELS,
  PREP_STATUS_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  lifecycleLabel,
  sourceLabel,
} from '@/components/orders/orderMeta';
import type { PrepStatus, PurchaseOrder } from '@/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Pedido detail "window" (sub-project D2): one VO's line items, aggregate status,
// ETA, and full edit history. Grouped by `vo`; a manual single-line order with no
// VO is addressed by its row id. Every SKU/order cross-link points here.
export default async function PedidoDetailPage({
  params,
}: {
  params: Promise<{ vo: string }>;
}) {
  const { vo: raw } = await params;
  const key = decodeURIComponent(raw);

  const [rows, session] = await Promise.all([fetchOrderRows(), auth()]);
  const isHead = session?.user?.isHead ?? false;
  const orders: PurchaseOrder[] = rows.map(mapPurchaseOrderRow);

  // Match by VO; fall back to a single order matched by id (drafts have no VO yet).
  const group = orders.filter((o) => (o.vo ? o.vo === key : o.id === key));

  if (group.length === 0) {
    return (
      <div>
        <BackLink />
        <PageHeader eyebrow="Pedido" title={key} />
        <EmptyState title="Pedido não encontrado" hint="Verifique o VO ou volte à lista de pedidos." />
      </div>
    );
  }

  const totalQty = group.reduce((s, o) => s + o.qtyOrdered, 0);
  const modals = [...new Set(group.map((o) => o.modal).filter(Boolean))] as string[];
  const prep = group[0].prepStatus; // a group shares one prep stage
  const status = group[0].status;
  const eta = group.map((o) => o.eta).filter(Boolean).sort()[0] ?? null;
  const orderDate = group.map((o) => o.orderDate).filter(Boolean).sort()[0] ?? null;

  // Frozen elaboration basis (item 8) — present on pedidos created via the builder.
  const snapshots = new Map<string, LineSnapshot>();
  for (const o of group) {
    if (!o.elaborationSnapshot) continue;
    try {
      snapshots.set(o.id, JSON.parse(o.elaborationSnapshot) as LineSnapshot);
    } catch {
      /* malformed snapshot → just skip the block for this line */
    }
  }
  const snapHeader = snapshots.size > 0 ? [...snapshots.values()][0] : null;

  // History: merge the audit log of every line row, newest first.
  const auditPerRow = await Promise.all(group.map((o) => readAuditLog('purchase_order', o.id)));
  const history = auditPerRow
    .flat()
    .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <BackLink />
        {isHead && <DeletePedidoButton ids={group.map((o) => o.id)} />}
      </div>
      <PageHeader
        eyebrow={group[0].vo ? `Pedido · VO ${group[0].vo}` : 'Pedido manual'}
        title={group[0].pedidoName ?? group[0].vo ?? group[0].skuName ?? key}
        subtitle={`${group.length} ${group.length === 1 ? 'item' : 'itens'} · ${fmtInt(totalQty)} un.${modals.length ? ` · ${modals.map((m) => MODAL_LABELS[m] ?? m).join(' / ')}` : ''}`}
      />

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Summary label="Estágio">
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>
            {lifecycleLabel(prep, status)}
          </span>
        </Summary>
        <Summary label="Tipo">{group[0].orderType ? ORDER_TYPE_LABELS[group[0].orderType] : '—'}</Summary>
        <Summary label="Fornecedor">{group[0].supplierName ?? '—'}</Summary>
        <Summary label="Data do pedido">{orderDate ? fmtDate(orderDate) : '—'}</Summary>
        <Summary label="ETA">{eta ? fmtDate(eta) : '—'}</Summary>
        <Summary label="Origem">{sourceLabel(group[0].source)}</Summary>
      </div>

      {/* Prep lifecycle (drafts only) */}
      {prep && (
        <div className="mb-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fluxo de elaboração
          </p>
          <PrepStatusControl ids={group.map((o) => o.id)} current={prep} isHead={isHead} />
        </div>
      )}

      {/* Frozen elaboration basis (item 8) — auditoria previsão × pedido */}
      {snapHeader && (
        <div className="mb-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Base da elaboração (congelada na criação)
            </p>
            <Link
              prefetch={false}
              href={`/dashboard/pedidos/${encodeURIComponent(key)}/previsao-realizado`}
              className="ml-auto text-xs font-medium text-brand-600 hover:underline"
            >
              Previsão × Realizado →
            </Link>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Previsão de {snapHeader.forecastAsOf ? fmtDate(snapHeader.forecastAsOf) : '—'} · critério{' '}
            {snapHeader.criteria?.mode === 'rop'
              ? 'estoque mín + segurança'
              : `DOH ≥ ${snapHeader.criteria?.dohThreshold ?? '—'}d`}
            {snapHeader.rules ? ' · com regras específicas deste pedido' : ''}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 font-medium">SKU</th>
                <th className="py-1 text-right font-medium">Sugerido</th>
                <th className="py-1 font-medium">Modal sugerido</th>
                <th className="py-1 text-right font-medium">Pedido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {group
                .filter((o) => snapshots.has(o.id))
                .map((o) => {
                  const s = snapshots.get(o.id)!;
                  const differs = s.suggestedQty != null && s.chosenQty != null && s.suggestedQty !== s.chosenQty;
                  return (
                    <tr key={o.id}>
                      <td className="py-1.5 font-mono text-xs">{o.sku}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {s.suggestedQty != null ? fmtInt(s.suggestedQty) : '—'}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {s.suggestedModal ? MODAL_LABELS[s.suggestedModal] ?? s.suggestedModal : '—'}
                      </td>
                      <td className={cn('py-1.5 text-right tabular-nums', differs && 'font-medium text-[color:var(--color-alert-warning)]')}>
                        {s.chosenQty != null ? fmtInt(s.chosenQty) : fmtInt(o.qtyOrdered)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Line items */}
      <div className="mb-6 overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd</th>
              <th className="px-3 py-2.5 font-medium">ETA</th>
              <th className="px-3 py-2.5 font-medium">Base</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {group.map((o) => (
              <tr key={o.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    prefetch={false}
                    href={`/dashboard/estoque?sku=${encodeURIComponent(toSkuBase(o.sku))}`}
                    className="font-mono text-xs text-brand-500 hover:text-brand-400"
                  >
                    {o.sku}
                  </Link>
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">{o.skuName ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(o.qtyOrdered)}</td>
                <td className="px-3 py-2 tabular-nums text-xs">{o.eta ? fmtDate(o.eta) : '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{o.hubId}</td>
                <td className="px-3 py-2 text-xs">{lifecycleLabel(o.prepStatus, o.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* History */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
      ) : (
        <ol className="space-y-2">
          {history.map((h, i) => (
            <li key={`${h.id}-${i}`} className="flex gap-3 rounded-lg bg-card px-3 py-2 text-xs ring-1 ring-foreground/10">
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {String(h.changed_at).slice(0, 16).replace('T', ' ')}
              </span>
              <span className="flex-1">
                <span className="font-medium text-foreground">{fieldLabel(String(h.field))}</span>
                {': '}
                <span className="text-muted-foreground">{fmtVal(h.old_value)} → </span>
                <span className="text-foreground">{fmtVal(h.new_value)}</span>
              </span>
              {h.changed_by != null && <span className="shrink-0 text-muted-foreground/70">{String(h.changed_by)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/pedidos"
      className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={13} /> Pedidos
    </Link>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}

/** Shape of the per-line elaboration_snapshot JSON (written by createPedido, item 8). */
interface LineSnapshot {
  forecastAsOf?: string;
  criteria?: { mode?: string; dohThreshold?: number };
  rules?: unknown;
  suggestedQty?: number | null;
  suggestedModal?: string | null;
  chosenQty?: number;
}

const FIELD_LABELS: Record<string, string> = {
  prep_status: 'Estágio',
  status: 'Status',
  qty_ordered: 'Quantidade',
  eta: 'ETA',
  modal: 'Modal',
  hub_id: 'Base',
  notes: 'Notas',
  is_deleted: 'Removido',
  created: 'Criação',
  id: 'ID',
  vo: 'VO',
  sku: 'SKU',
  sku_name: 'Item',
  order_date: 'Data do pedido',
  lead_time_days: 'Lead time (dias)',
  source: 'Origem',
  updated_by: 'Atualizado por',
  pedido_name: 'Nome',
  order_type: 'Tipo',
};
function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  const s = String(v);
  try {
    const parsed = JSON.parse(s);
    if (parsed === null) return '—';
    if (typeof parsed === 'boolean') return parsed ? 'sim' : 'não';
    const asStr = String(parsed);
    // Dates land as ISO (YYYY-MM-DD[…]) — display dd-mm-YYYY like the rest of the app.
    if (/^\d{4}-\d{2}-\d{2}/.test(asStr)) return fmtDate(asStr);
    return (
      PREP_STATUS_LABELS[parsed as PrepStatus] ??
      STATUS_LABELS[parsed as keyof typeof STATUS_LABELS] ??
      MODAL_LABELS[asStr] ??
      SOURCE_LABELS[asStr] ??
      ORDER_TYPE_LABELS[asStr] ??
      asStr
    );
  } catch {
    return s;
  }
}
