import { safeComputeSnapshot } from '@/lib/planning/load';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { EmptyState, FreshnessBanner, PageHeader } from '@/components/planning/ui';
import { LeadTimeTable, type LeadTimeRow } from '@/components/planning/LeadTimeTable';

export const dynamic = 'force-dynamic';

export default async function LeadTimesPage() {
  const snap = await safeComputeSnapshot();

  if (snap.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Lead times" title="Lead times por modal" />
        <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para editar os lead times." />
      </div>
    );
  }

  const leadRows: LeadTimeRow[] = snap.stocks
    .map((s) => {
      const p =
        snap.policies.get(s.skuBase) ??
        defaultPolicyFor(s.skuBase, s, snap.forecasts.get(s.skuBase)?.abcClass ?? 'C', snap.today);
      return {
        skuBase: s.skuBase,
        skuName: s.skuName,
        leadTimeSource: p.leadTimeSource,
        seaDays: p.leadTimeSeaDays ?? p.leadTimeDays,
        airDays: p.leadTimeAirDays ?? p.leadTimeDays,
        defaultModal: p.defaultModal,
      };
    })
    .sort((a, b) => a.skuName.localeCompare(b.skuName, 'pt-BR'));

  return (
    <div>
      <PageHeader
        eyebrow="Lead times"
        title="Lead times por modal"
        subtitle="Lead time marítimo e aéreo de cada SKU e o modal padrão — o padrão define o lead efetivo usado no cálculo de recompra e da data-limite (buy-by)"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      <LeadTimeTable rows={leadRows} />
    </div>
  );
}
