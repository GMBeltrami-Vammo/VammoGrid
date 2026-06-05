import { cn } from '@/lib/utils';
import type { DohStatus } from '@/types';

const STATUS_STYLES: Record<DohStatus, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  ok: 'bg-brand-100 text-brand-700 border-brand-200',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200',
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
