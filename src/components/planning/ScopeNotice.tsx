import Link from 'next/link';
import { Layers } from 'lucide-react';
import { fmtInt } from '@/lib/planning/format';

// Explains WHY an analysis shows fewer SKUs than the full catalog: it's narrowed to the
// curated default scope (+ any active filters). Shown on the scoped pages (Visão Geral,
// Semanas, Compras) so the smaller count doesn't read as missing data, with a one-click
// path to the SKUs page to review/widen the scope. Hidden when nothing is narrowed.
export function ScopeNotice({ shown, total }: { shown: number; total: number }) {
  if (total <= 0 || shown >= total) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-brand-500/5 px-3 py-2 text-xs text-muted-foreground ring-1 ring-brand-500/15">
      <Layers size={13} className="text-brand-600" />
      <span>
        Análise sobre <b className="text-foreground">{fmtInt(shown)}</b> de {fmtInt(total)} SKUs (seleção ou escopo padrão).
      </span>
      <Link href="/dashboard/skus" className="ml-auto font-medium text-brand-600 hover:underline">
        Ver catálogo / ajustar escopo →
      </Link>
    </div>
  );
}
