import type { AlertSeverity, PurchaseStatus, RiskLevel } from '@/types/planning';

// pt-BR formatting + status→label/color maps shared across the planning UI.

const ptInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const ptBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const fmtInt = (n: number | null | undefined): string =>
  n == null ? '—' : ptInt.format(Math.round(n));

export const fmtNum = (n: number | null | undefined, digits = 1): string =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(n);

export const fmtBRL = (n: number | null | undefined): string =>
  n == null ? '—' : ptBRL.format(n);

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Whole days from today (UTC) to an ISO date; null when no date. */
export function daysFromToday(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;
  const a = new Date(`${today}T00:00:00Z`).getTime();
  const b = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  CRITICAL: 'Crítico',
  REORDER: 'Recomprar',
  OK: 'OK',
};

/** Tailwind text+bg classes keyed to the Vammo alert tokens. */
export const PURCHASE_STATUS_CLASS: Record<PurchaseStatus, string> = {
  CRITICAL: 'bg-alert-error/15 text-alert-error',
  REORDER: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]',
  OK: 'bg-alert-success/15 text-alert-success',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

export const RISK_CLASS: Record<RiskLevel, string> = {
  high: 'bg-alert-error/15 text-alert-error',
  medium: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]',
  low: 'bg-muted text-muted-foreground',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
};

export const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  critical: 'bg-alert-error/15 text-alert-error',
  warning: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]',
  info: 'bg-brand-500/15 text-brand-600',
};

export const HUB_SHORT: Record<string, string> = {
  osasco: 'OSA',
  mooca: 'MOO',
  sbc: 'SBC',
};
