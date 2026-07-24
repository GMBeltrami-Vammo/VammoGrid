import { Database, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isoToDisplayDate } from '@/lib/planning/format';
import type { ForecastSource } from '@/types/planning';

// Provenance badge: which upstream model produced a SKU's forecast (decisions.MD #33).
// Hook-free + presentational (plain span + lucide icon) so it renders in BOTH server
// components (Estoque page header) and client components (SKU list, SKU popup).
// The as_of date makes staleness visible — the primary source is preferred
// unconditionally, so a stale-but-preferred series should still be obvious.

const META: Record<ForecastSource, { label: string; Icon: typeof Sparkles; primary: boolean }> = {
  'consumo-diario': { label: 'Consumo diário', Icon: Sparkles, primary: true },
  sop: { label: 'S&OP', Icon: Database, primary: false },
};

export function ForecastSourceBadge({
  source,
  asOfDate,
  modelVersion,
  compact = false,
  className,
}: {
  source?: ForecastSource | null;
  asOfDate?: string | null;
  modelVersion?: string | null;
  /** compact = icon only (SKU list); full = labeled pill (header/popup). */
  compact?: boolean;
  className?: string;
}) {
  if (!source) return null;
  const { label, Icon, primary } = META[source];
  const asOf = asOfDate ? isoToDisplayDate(asOfDate) : '';
  const title = `Previsão: ${label}${modelVersion ? ` (${modelVersion})` : ''}${asOf ? ` · dados de ${asOf}` : ''}`;
  const tone = primary
    ? 'bg-brand-500/10 text-brand-600 ring-brand-500/20'
    : 'bg-muted text-muted-foreground ring-foreground/10';

  if (compact) {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn('inline-flex size-4 items-center justify-center rounded-full ring-1', tone, className)}
      >
        <Icon className="size-2.5" aria-hidden />
      </span>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-4xl px-2 py-0.5 text-xs font-medium ring-1',
        tone,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
      {asOf ? ` · ${asOf}` : ''}
    </span>
  );
}
