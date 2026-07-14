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
  /** Meta comercial: novas motos/mês como % da frota (null = não informado). */
  commercial_target_pct: number | null;
  /** Churn: motos que saem/mês como % da frota (null = não informado). */
  churn_pct: number | null;
  as_of_date: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const fetchFleetInfoRows = unstable_cache(
  async (): Promise<FleetInfoRow[]> => readFleetTable<FleetInfoRow>(FLEET_TABLES.fleetInfo),
  ['fleet-info-rows'],
  { revalidate: 3600, tags: ['fleet-info'] },
);
