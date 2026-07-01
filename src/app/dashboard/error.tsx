'use client';

// Route-level error boundary for the dashboard subtree. Catches unexpected
// errors (network failures, schema mismatches) and offers a reload rather than
// a blank screen.

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl bg-card p-12 ring-1 ring-alert-error/30 text-center">
      <p className="text-sm font-semibold text-alert-error">Erro ao carregar dados</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {error.message || 'Ocorreu um erro inesperado. Verifique as credenciais de ClickHouse.'}
      </p>
      {error.digest && (
        <p className="font-mono text-[10px] text-muted-foreground/60">{error.digest}</p>
      )}
      <button
        onClick={reset}
        className="rounded-md bg-brand-500/15 px-4 py-2 text-xs font-medium text-brand-600 hover:bg-brand-500/25 transition-colors"
      >
        Tentar novamente
      </button>
    </div>
  );
}
