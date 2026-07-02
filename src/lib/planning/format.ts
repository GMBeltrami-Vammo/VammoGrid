import type { AlertSeverity, PurchaseStatus, RiskLevel, WeekCell } from '@/types/planning';

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

// Always DD-MM-YYYY (never MM-DD). Built by string slicing on the canonical
// YYYY-MM-DD so there's zero locale ambiguity. Accepts a full ISO timestamp too.
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10); // YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ── Editable DD-MM-YYYY date field helpers (used by <DateField>) ──────────────
// The native <input type="date"> renders in the browser locale (often MM/DD/YYYY);
// we always show/accept DD-MM-YYYY. These convert to/from the canonical ISO string.

/** ISO YYYY-MM-DD → DD-MM-YYYY for display, or '' when empty/invalid. */
export function isoToDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/**
 * Parse a typed DD-MM-YYYY (or DD/MM/YYYY, 2-digit year → 20xx) into a canonical ISO
 * YYYY-MM-DD, or null if incomplete/invalid. Rejects overflow dates (e.g. 31-02) via
 * a round-trip check.
 */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

/** Weekly-grid cell color. Precedence: out > low > inbound (PO) > recovery > ok. */
export function weekCellClass(c: WeekCell): string {
  if (c.isOut) return 'bg-alert-error/15 text-alert-error';
  if (c.isLow) return 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]';
  if (c.inbound > 0) return 'bg-alert-success/10 text-alert-success';
  if (c.recovery > 0) return 'bg-brand-500/10 text-brand-600';
  return 'text-foreground';
}
