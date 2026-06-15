import { cn } from '@/lib/utils';
import type { DohStatus } from '@/types';

const STATUS_STYLES: Record<DohStatus, string> = {
  critical:
    'bg-alert-error/12 text-alert-error border-alert-error/25',
  warning:
    'bg-alert-warning/12 text-[#b8a800] border-alert-warning/25 dark:text-alert-warning dark:border-alert-warning/30',
  ok: 'bg-brand-500/10 text-brand-700 border-brand-300/40 dark:text-brand-400 dark:border-brand-500/25',
  unknown:
    'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/35 dark:border-white/10',
};

const STATUS_LABELS: Record<DohStatus, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  ok: 'OK',
  unknown: 'N/D',
};

interface DohBadgeProps {
  doh: number | null;
  status: DohStatus;
  showDays?: boolean;
}

export function DohBadge({ doh, status, showDays = true }: DohBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums',
        STATUS_STYLES[status],
      )}
    >
      {showDays && doh !== null ? `${Math.round(doh)}d` : STATUS_LABELS[status]}
    </span>
  );
}
