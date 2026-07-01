import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  PURCHASE_STATUS_CLASS,
  PURCHASE_STATUS_LABEL,
  RISK_CLASS,
  RISK_LABEL,
  SEVERITY_CLASS,
  SEVERITY_LABEL,
  fmtDateLong,
} from '@/lib/planning/format';
import type { AlertSeverity, PurchaseStatus, RiskLevel } from '@/types/planning';

// Server-safe presentational primitives for the planning surfaces. Plain elements
// (no hooks) so they render in Server Components.

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: PurchaseStatus }) {
  return <Pill className={PURCHASE_STATUS_CLASS[status]}>{PURCHASE_STATUS_LABEL[status]}</Pill>;
}

export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <Pill className={RISK_CLASS[risk]}>{RISK_LABEL[risk]}</Pill>;
}

export function SeverityPill({ severity }: { severity: AlertSeverity }) {
  return <Pill className={SEVERITY_CLASS[severity]}>{SEVERITY_LABEL[severity]}</Pill>;
}

export function LatePill() {
  return <Pill className="bg-alert-error/15 text-alert-error">Atrasado</Pill>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'brand';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-alert-error'
      : tone === 'warning'
        ? 'text-[color:var(--color-alert-warning)]'
        : tone === 'success'
          ? 'text-alert-success'
          : tone === 'brand'
            ? 'text-brand-500'
            : 'text-foreground';
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums tracking-tight', toneClass)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FreshnessBanner({
  asOfDate,
  backend,
}: {
  asOfDate: string;
  backend: 'clickhouse' | 'none';
}) {
  const backendLabel = backend === 'clickhouse' ? 'ClickHouse (direto)' : 'sem fonte';
  const stale = backend === 'none';
  return (
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs ring-1',
        stale
          ? 'bg-alert-warning/10 text-[color:var(--color-alert-warning)] ring-alert-warning/30'
          : 'bg-muted/50 text-muted-foreground ring-foreground/10',
      )}
    >
      <span>
        Previsão de demanda <strong>de {fmtDateLong(asOfDate)}</strong> (S&amp;OP)
      </span>
      <span className="opacity-60">·</span>
      <span>Fonte: {backendLabel}</span>
      {stale && (
        <span className="font-medium">
          — credenciais de dados não configuradas; valores indisponíveis.
        </span>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-foreground/15 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}
