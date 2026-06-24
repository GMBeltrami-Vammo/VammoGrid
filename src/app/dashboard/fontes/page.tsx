import { activeBackendKind } from '@/lib/clickhouse/reader';
import { fetchRecoveryRefreshedAt } from '@/lib/planning/recoveryRefresh';
import { LINEAGE_SECTIONS, type LineageRow } from '@/lib/planning/lineage';
import { fmtDateLong } from '@/lib/planning/format';
import { PageHeader } from '@/components/planning/ui';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Classify a source string into an origin badge (ClickHouse / Supabase / Metabase /
// Seed·Const / Cookie / Derivado) for quick visual scanning.
function originBadge(source: string): { label: string; cls: string } {
  if (/clickhouse|analytics\.|dev\./i.test(source)) return { label: 'ClickHouse', cls: 'bg-brand-500/15 text-brand-600' };
  if (/metabase|#295/i.test(source)) return { label: 'Metabase', cls: 'bg-alert-warning/15 text-[color:var(--color-alert-warning)]' };
  if (/supabase|fleet\.|job_run/i.test(source)) return { label: 'Supabase', cls: 'bg-alert-success/15 text-alert-success' };
  if (/seed|constants|planningHubs|NATIONAL|@\/types/i.test(source)) return { label: 'Seed · Const', cls: 'bg-muted text-muted-foreground' };
  if (/cookie/i.test(source)) return { label: 'Cookie', cls: 'bg-muted text-muted-foreground' };
  return { label: 'Derivado', cls: 'bg-muted text-muted-foreground' };
}

const slug = (i: number) => `secao-${i}`;

const FLOW = [
  { label: 'Fontes', detail: 'ClickHouse · Supabase · Metabase · seed' },
  { label: 'Adaptadores', detail: 'lib/planning/source/*' },
  { label: 'Política + Motores', detail: 'policy · projeção · compras · transferências' },
  { label: 'Aplicação', detail: 'load → páginas (RSC) + UI' },
];

export default async function FontesPage() {
  const backend = activeBackendKind();
  const recoveryRefreshedAt = await fetchRecoveryRefreshedAt();

  const backendLabel =
    backend === 'clickhouse' ? 'ClickHouse (direto)' : backend === 'metabase' ? 'Metabase (fallback)' : 'Sem backend';

  return (
    <div>
      <PageHeader
        eyebrow="Referência técnica"
        title="Fontes & Fórmulas"
        subtitle="A origem e o fluxo de cada valor — fonte (ClickHouse, Supabase, Metabase, seed), fórmula exata e referência de código. Documentação viva do pipeline de planejamento."
      />

      {/* Live state */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground">
          Backend de analytics: <span className="font-medium text-foreground">{backendLabel}</span>
        </span>
        {recoveryRefreshedAt && (
          <span className="rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground">
            Recuperação (IMS) atualizada em{' '}
            <span className="font-medium text-foreground">{fmtDateLong(recoveryRefreshedAt.slice(0, 10))}</span>
          </span>
        )}
      </div>

      {/* Flow strip */}
      <div className="mb-6 flex flex-wrap items-stretch gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
        {FLOW.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold text-foreground">{stage.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{stage.detail}</p>
            </div>
            {i < FLOW.length - 1 && <span className="text-muted-foreground/50">→</span>}
          </div>
        ))}
      </div>

      {/* TOC */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {LINEAGE_SECTIONS.map((s, i) => (
          <a
            key={s.title}
            href={`#${slug(i)}`}
            className="rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {i + 1}. {s.title}
          </a>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-10">
        {LINEAGE_SECTIONS.map((section, i) => (
          <section key={section.title} id={slug(i)} className="scroll-mt-6">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted-foreground/60">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="text-lg font-bold text-foreground">{section.title}</h2>
            </div>
            <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{section.blurb}</p>
            <div className="grid gap-3 xl:grid-cols-2">
              {section.rows.map((row) => (
                <Entry key={row.name} row={row} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Entry({ row }: { row: LineageRow }) {
  const badge = originBadge(row.source);
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{row.name}</h4>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', badge.cls)}>{badge.label}</span>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-medium text-muted-foreground">Fonte</dt>
          <dd className="text-foreground/80">{row.source}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-medium text-muted-foreground">Fórmula</dt>
          <dd className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
            {row.formula}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-medium text-muted-foreground">Notas</dt>
          <dd className="text-muted-foreground">{row.notes}</dd>
        </div>
      </dl>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">{row.ref}</p>
    </div>
  );
}
