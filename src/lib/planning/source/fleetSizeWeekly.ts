import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

// Weekly REAL fleet size per model segment (dev.fleet_size_weekly — review item 2).
// The Frota chart plots these as the realized past and anchors the projection on the
// latest record per segment.

export interface FleetWeeklySizeRow {
  segment: string;
  week_start: string;
  size: number;
  updated_by: string | null;
  updated_at: string;
}

const fetchRows = unstable_cache(
  async (): Promise<FleetWeeklySizeRow[]> => readFleetTable<FleetWeeklySizeRow>(FLEET_TABLES.fleetSizeWeekly),
  ['fleet-size-weekly-rows'],
  { revalidate: 3600, tags: ['fleet-size'] },
);

/** All weekly records, sorted by (segment, week_start asc). Empty on error. */
export async function fetchFleetWeeklySizes(): Promise<FleetWeeklySizeRow[]> {
  try {
    const rows = await fetchRows();
    return rows
      .map((r) => ({ ...r, week_start: String(r.week_start).slice(0, 10), size: Number(r.size) || 0 }))
      .sort((a, b) =>
        a.segment === b.segment ? a.week_start.localeCompare(b.week_start) : a.segment.localeCompare(b.segment),
      );
  } catch (e) {
    console.error('[fetchFleetWeeklySizes]', e instanceof Error ? e.message : e);
    return [];
  }
}
