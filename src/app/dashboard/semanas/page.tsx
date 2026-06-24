import { safeComputeSnapshot } from '@/lib/planning/load';
import { buildWeekGrid } from '@/lib/planning/weekgrid';
import { defaultPolicyFor } from '@/lib/planning/policy';
import { EmptyState, FreshnessBanner, PageHeader, SectionTitle } from '@/components/planning/ui';
import { WeekGridView } from '@/components/planning/WeekGridView';
import { LeadTimeTable, type LeadTimeRow } from '@/components/planning/LeadTimeTable';

export const dynamic = 'force-dynamic';

export default async function SemanasPage() {
  const snap = await safeComputeSnapshot();

  if (snap.stocks.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Semanas" title="Projeção semanal" />
        <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />
        <EmptyState title="Sem dados" hint="Configure a fonte de dados para gerar a projeção semanal." />
      </div>
    );
  }

  const grid = buildWeekGrid({ inputs: snap, purchases: snap.purchases });

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
        eyebrow="Semanas"
        title="Projeção semanal"
        subtitle="Estoque projetado por SKU nas próximas 8 semanas — cobertura, ruptura e semana-limite de compra, por hub"
      />
      <FreshnessBanner asOfDate={snap.asOfDate} backend={snap.backend} />

      <WeekGridView grid={grid} />

      <div className="mt-8">
        <SectionTitle>Lead times por modal (editável)</SectionTitle>
        <p className="mb-3 text-xs text-muted-foreground">
          Defina o lead time marítimo e aéreo de cada SKU e qual modal é o padrão. O modal padrão
          determina o lead efetivo usado no cálculo de recompra e da data-limite (buy-by).
        </p>
        <LeadTimeTable rows={leadRows} />
      </div>
    </div>
  );
}
