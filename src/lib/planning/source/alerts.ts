import 'server-only';
import type { AlertCode, AlertSeverity, HubId, PlanningAlert } from '@/types/planning';
import { chQuery } from '@/lib/clickhouse/reader';

// Consume the upstream coverage alerts (dev.sop_alerts) at the latest run. location
// is currently 'ALL' (fleet-level); we surface it as-is and the engines add per-hub
// alerts on top. metrics is a JSON blob ({cover, LT, OH, demand_LT, ...}).

interface AlertRow {
  sku_base: string;
  location: string;
  sku_description: string;
  abc_class: string;
  alert_code: string;
  severity: string;
  reason: string;
  metrics: string;
  unit_price: number | string | null;
}

const ALERTS_SQL = `
SELECT sku_base, location, sku_description, abc_class, alert_code, severity, reason,
       metrics, toFloat64(unit_price) AS unit_price
FROM dev.sop_alerts
WHERE as_of_date = (SELECT max(as_of_date) FROM dev.sop_alerts)`;

const KNOWN_CODES = new Set<AlertCode>([
  'STK_RUPTURE',
  'STK_BELOW_ROP',
  'STK_BELOW_SS',
  'DEM_TREND_UP',
  'DEM_VARIABILITY',
  'STK_OBSOLETE',
]);

function asSeverity(s: string): AlertSeverity {
  return s === 'critical' || s === 'warning' ? s : 'info';
}

function parseMetrics(raw: string): Record<string, number> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export async function fetchSopAlerts(): Promise<PlanningAlert[]> {
  const rows = await chQuery<AlertRow>(ALERTS_SQL);
  const out: PlanningAlert[] = [];
  for (const r of rows) {
    const code = String(r.alert_code) as AlertCode;
    if (!KNOWN_CODES.has(code)) continue;
    const loc = String(r.location);
    out.push({
      code,
      severity: asSeverity(String(r.severity)),
      skuBase: String(r.sku_base),
      skuName: String(r.sku_description ?? r.sku_base),
      hub: (loc === 'ALL' ? 'ALL' : (loc.toLowerCase() as HubId)),
      reason: String(r.reason ?? ''),
      metrics: parseMetrics(String(r.metrics ?? '{}')),
      unitPrice: r.unit_price == null ? null : Number(r.unit_price),
    });
  }
  return out;
}
