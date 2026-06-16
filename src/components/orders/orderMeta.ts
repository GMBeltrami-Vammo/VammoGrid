import type { PurchaseOrderStatus } from '@/types';

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
