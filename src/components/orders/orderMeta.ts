import type { PrepStatus, PurchaseOrderStatus } from '@/types';

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  ordered: 'Pedido',
  in_transit: 'Em trânsito',
  customs: 'Alfândega',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

export const STATUS_ORDER: PurchaseOrderStatus[] = [
  'ordered',
  'in_transit',
  'customs',
  'received',
  'cancelled',
];

export const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  ordered:
    'bg-brand-500/10 text-brand-700 border-brand-300/40 dark:text-brand-400 dark:border-brand-500/25',
  in_transit:
    'bg-alert-info/12 text-[#0a72ad] border-alert-info/30 dark:text-alert-info',
  customs:
    'bg-alert-warning/12 text-[#b8a800] border-alert-warning/25 dark:text-alert-warning dark:border-alert-warning/30',
  received:
    'bg-alert-success/12 text-[#3f8a2f] border-alert-success/30 dark:text-alert-success',
  cancelled:
    'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/35 dark:border-white/10',
};

export const MODAL_LABELS: Record<string, string> = {
  air: 'Aéreo',
  sea: 'Marítimo',
};

/** Where the pedido came from (dev.fleet_purchase_order.source) — pt-BR display. */
export const SOURCE_LABELS: Record<string, string> = {
  clickhouse: 'Sincronizado',
  manual: 'Manual',
  elaboracao: 'Novo Pedido',
  import: 'Importado',
};

/** Pedido classification (review 7a/3b). */
export const ORDER_TYPE_LABELS: Record<string, string> = {
  nacional: 'Nacional',
  internacional: 'Internacional',
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source;
}

// Preparation lifecycle (sub-projects B6/D1), preceding the shipping status.
export const PREP_STATUS_LABELS: Record<PrepStatus, string> = {
  elaborado: 'Elaborado',
  enviado: 'Enviado',
  feito: 'Feito',
};

export const PREP_STATUS_ORDER: PrepStatus[] = ['elaborado', 'enviado', 'feito'];

export const PREP_STATUS_STYLES: Record<PrepStatus, string> = {
  elaborado:
    'bg-alert-warning/12 text-[#b8a800] border-alert-warning/25 dark:text-alert-warning dark:border-alert-warning/30',
  enviado:
    'bg-alert-info/12 text-[#0a72ad] border-alert-info/30 dark:text-alert-info',
  feito:
    'bg-alert-success/12 text-[#3f8a2f] border-alert-success/30 dark:text-alert-success',
};

/** Full lifecycle label: the prep stage (if any) then the shipping status. */
export function lifecycleLabel(prep: PrepStatus | null, status: PurchaseOrderStatus): string {
  return prep && prep !== 'feito' ? PREP_STATUS_LABELS[prep] : STATUS_LABELS[status];
}
