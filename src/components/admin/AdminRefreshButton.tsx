'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// Small Head-only action button that GETs an admin route (cache refresh / backfill),
// shows a spinner while pending and an inline result afterwards. The caller decides the
// route, labels, icon and whether to router.refresh() the current page on success.
export function AdminRefreshButton({
  href,
  idleLabel,
  pendingLabel = 'Atualizando…',
  icon,
  className,
  refreshOnDone = false,
  doneLabel,
  formatDone,
}: {
  href: string;
  idleLabel: string;
  pendingLabel?: string;
  icon?: ReactNode;
  className?: string;
  /** Re-render the current route after a successful call (to reflect fresh data). */
  refreshOnDone?: boolean;
  /** Static success message — use this from Server Components (functions can't cross the
   *  RSC boundary). */
  doneLabel?: string;
  /** Build the success message from the route's JSON (client-component callers only).
   *  Takes precedence over doneLabel; defaults to "Feito". */
  formatDone?: (json: Record<string, unknown>) => string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const click = () => {
    setStatus(null);
    start(async () => {
      try {
        const res = await fetch(href, { method: 'GET', cache: 'no-store' });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok && json.ok !== false) {
          setStatus({ kind: 'ok', msg: formatDone ? formatDone(json) : (doneLabel ?? 'Feito') });
          if (refreshOnDone) router.refresh();
        } else {
          setStatus({ kind: 'err', msg: String(json.error ?? `Erro ${res.status}`) });
        }
      } catch (e) {
        setStatus({ kind: 'err', msg: e instanceof Error ? e.message : 'Falha de rede' });
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {status && (
        <span
          className={cn(
            'text-[11px]',
            status.kind === 'ok' ? 'text-alert-success' : 'text-alert-error',
          )}
        >
          {status.msg}
        </span>
      )}
      <button
        type="button"
        onClick={click}
        disabled={pending}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50',
          className,
        )}
      >
        <span className={cn(pending && 'animate-spin')}>{icon ?? <RefreshCw size={13} />}</span>
        {pending ? pendingLabel : idleLabel}
      </button>
    </div>
  );
}
