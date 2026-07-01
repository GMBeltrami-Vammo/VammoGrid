import { auth } from '@/auth';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { PageHeader } from '@/components/planning/ui';
import { BacklogPanel, type BacklogRow } from '@/components/planning/BacklogPanel';
import type { BacklogStatus } from '@/app/dashboard/backlog/actions';

export const dynamic = 'force-dynamic';

interface BacklogTableRow {
  id: string;
  model: string;
  stalled_since: string;
  reason: string | null;
  status: string;
  resolved_at: string | null;
  notes: string | null;
}

// Backlog / motos paradas registry (sub-project G1): stalled bikes awaiting parts,
// searchable + status-filterable. Reactivating them feeds the heatmap's backlog
// scenario (G2).
export default async function BacklogPage() {
  const [rowsRaw, session] = await Promise.all([
    readFleetTable<BacklogTableRow>(FLEET_TABLES.backlogBikeLog).catch(() => []),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

  const rows: BacklogRow[] = rowsRaw
    .map((r) => ({
      id: r.id,
      model: r.model,
      stalledSince: String(r.stalled_since).slice(0, 10),
      reason: r.reason,
      status: (['parado', 'em_reparo', 'reativado'].includes(r.status) ? r.status : 'parado') as BacklogStatus,
      resolvedAt: r.resolved_at ? String(r.resolved_at).slice(0, 10) : null,
      notes: r.notes,
    }))
    .sort((a, b) => (a.stalledSince < b.stalledSince ? 1 : a.stalledSince > b.stalledSince ? -1 : 0));

  return (
    <div>
      <PageHeader
        eyebrow="Backlog"
        title="Motos paradas"
        subtitle="Registro de motos paradas aguardando peças — buscar, filtrar por status e acompanhar a reativação. Todo registro é logado."
      />
      <BacklogPanel rows={rows} isHead={isHead} />
    </div>
  );
}
