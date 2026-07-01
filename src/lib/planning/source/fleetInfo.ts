import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

// Fleet size / growth-rate parameters from ClickHouse dev.fleet_info (formerly
// Supabase fleet.fleet_info; see decisions.MD #11). Read path for the client-side
// useFleetInfo hook (via /api/fleet/fleet-info) — the hook can no longer query
// ClickHouse directly from the browser.

export interface FleetInfoRow {
  segment: string;
  current_size: number;
  monthly_growth_rate: number;
  as_of_date: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const fetchFleetInfoRows = unstable_cache(
  async (): Promise<FleetInfoRow[]> => readFleetTable<FleetInfoRow>(FLEET_TABLES.fleetInfo),
  ['fleet-info-rows'],
  { revalidate: 3600, tags: ['fleet-info'] },
);
