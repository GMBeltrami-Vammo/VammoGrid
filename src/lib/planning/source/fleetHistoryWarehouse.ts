import 'server-only';
import { chQuery } from '@/lib/clickhouse/reader';

// Historical fleet size per segment, read from the warehouse (analytics.mart_weekly_fleet_status).
// Definition: RENTABLE (the 'main' category = deployed functional fleet: rented + available-to-
// rent; excludes defleeted / lost / non-rentable / pre-activated) — the right denominator for
// parts consumption, and the one that matches the app's current fleet_info. Aggregated to MONTHLY
// points and mapped to the app's CPX / COMFORT segments (VS1 dropped — a dying handful). Feeds the
// one-off Head-gated backfill route that seeds dev.fleet_size_weekly control points.

export interface FleetHistoryPoint {
  segment: string;
  /** First day of the month (YYYY-MM-DD) — the control-point date. */
  monthStart: string;
  size: number;
}

const MODEL_TO_SEGMENT: Record<string, string> = {
  'VMOTO CPX': 'CPX',
  'VAMMO COMFORT': 'COMFORT',
};

const HISTORY_SQL = `
SELECT
  toString(toStartOfMonth(week_start_date)) AS month_start,
  bike_model_name,
  round(avg(avg_daily_bikes)) AS size
FROM analytics.mart_weekly_fleet_status
WHERE category_level = 'main' AND category_name = 'RENTABLE'
  AND bike_model_name IN ('VMOTO CPX', 'VAMMO COMFORT')
GROUP BY month_start, bike_model_name
HAVING size > 0
ORDER BY bike_model_name, month_start`;

interface HistoryRow {
  month_start: string;
  bike_model_name: string;
  size: number | string;
}

/** Pure: warehouse rows → CPX/COMFORT monthly control points. Drops unknown models, non-positive
 *  sizes and malformed dates so the backfill never writes junk. */
export function mapFleetHistoryRows(rows: HistoryRow[]): FleetHistoryPoint[] {
  return rows
    .map((r) => ({
      segment: MODEL_TO_SEGMENT[r.bike_model_name] ?? '',
      monthStart: String(r.month_start).slice(0, 10),
      size: Math.max(0, Math.round(Number(r.size) || 0)),
    }))
    .filter((p) => p.segment !== '' && p.size > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.monthStart));
}

/** Monthly RENTABLE fleet-size control points from the warehouse. Empty on error / absent table
 *  (the mart may not exist in every environment — the backfill route reports the empty read). */
export async function fetchFleetHistoryPoints(): Promise<FleetHistoryPoint[]> {
  try {
    const rows = await chQuery<HistoryRow>(HISTORY_SQL);
    return mapFleetHistoryRows(rows);
  } catch (e) {
    console.error('[fetchFleetHistoryPoints]', e instanceof Error ? e.message : e);
    return [];
  }
}
