import Link from 'next/link';
import type { TransportModal } from '@/types/planning';
import { InfoHint } from '@/components/planning/InfoHint';

// Read-only lead-time summary on the SKU cadastro. Lead time is now a SUPPLIER
// attribute — the SKU's effective lead comes from its preferred supplier (edited in
// Fornecedores). When the SKU has no supplier, it falls back to the SKU's own lead.

export function LeadTimePanel({
  seaDays,
  airDays,
  defaultModal,
  supplierName,
}: {
  seaDays: number;
  airDays: number;
  defaultModal: TransportModal;
  /** Preferred supplier the lead came from; null = no supplier (using the SKU fallback). */
  supplierName: string | null;
}) {
  const effective = defaultModal === 'air' ? airDays : seaDays;
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="inline-flex items-center gap-1">Lead time <InfoHint id="lead-time" /></span>
        {supplierName ? ` · fornecedor ${supplierName}` : ' · sem fornecedor'}
      </p>
      <p className="mt-1 text-sm text-foreground">
        Marítimo <span className="font-semibold tabular-nums">{seaDays}d</span> · Aéreo{' '}
        <span className="font-semibold tabular-nums">{airDays}d</span> · padrão{' '}
        <span className="font-semibold">{defaultModal === 'air' ? 'aéreo' : 'marítimo'}</span> → efetivo{' '}
        <span className="font-semibold tabular-nums">{effective}d</span>
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {supplierName ? (
          <>
            O lead vem do fornecedor preferido. Para alterar, edite o fornecedor em{' '}
            <Link href="/dashboard/fornecedores" className="text-brand-600 underline hover:text-brand-500">
              Fornecedores
            </Link>
            .
          </>
        ) : (
          <>
            Sem fornecedor vinculado — usando o lead do próprio SKU (fallback). Vincule um fornecedor no
            painel abaixo para o lead passar a vir dele.
          </>
        )}
      </p>
    </div>
  );
}
