import 'server-only';
import { unstable_cache } from 'next/cache';
import type { SkuPolicy, TransportModal } from '@/types/planning';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';

// Reads per-SKU policy overrides from dev.fleet_sku_policy (ClickHouse — formerly
// Supabase fleet.sku_policy; see decisions.MD #11).
// Only columns present in the row override the defaults — missing columns
// fall back to national-lead-time seed / ABC defaults in buildPolicies.

interface PolicyRow {
  sku_base: string;
  lead_time_days: number | null;
  lead_time_source: string | null;
  lead_time_sea_days: number | null;
  lead_time_air_days: number | null;
  default_modal: string | null;
  lead_time_std_days: number | null;
  is_national: boolean | null;
  abc_class: string | null;
  target_doi: number | null;
  recovery_rate: number;
  recovery_turnaround_days: number;
  safety_override: number | null;
  is_repairable: boolean | null;
  updated_by: string | null;
  updated_at: string;
}

// Cache the raw policy rows across requests; revalidateTag('policies') fires on every
// in-app edit (lead-time / safety / recovery actions) and the recovery cron, so edits
// show immediately. Throws on error so failures are not cached.
const fetchPolicyRows = unstable_cache(
  async (): Promise<PolicyRow[]> => readFleetTable<PolicyRow>(FLEET_TABLES.skuPolicy),
  ['sku-policy-rows'],
  { revalidate: 300, tags: ['policies'] },
);

export async function fetchSkuPolicies(): Promise<Map<string, Partial<SkuPolicy>>> {
  try {
    const rows = await fetchPolicyRows();
    const map = new Map<string, Partial<SkuPolicy>>();
    for (const r of rows) {
      const override: Partial<SkuPolicy> = {
        recoveryRate: Number(r.recovery_rate) || 0,
        recoveryTurnaroundDays: Number(r.recovery_turnaround_days) || 14,
      };
      if (r.lead_time_days != null) override.leadTimeDays = r.lead_time_days;
      if (r.lead_time_source != null)
        override.leadTimeSource = r.lead_time_source as SkuPolicy['leadTimeSource'];
      if (r.lead_time_sea_days != null) override.leadTimeSeaDays = r.lead_time_sea_days;
      if (r.lead_time_air_days != null) override.leadTimeAirDays = r.lead_time_air_days;
      if (r.default_modal != null) override.defaultModal = r.default_modal as TransportModal;
      if (r.lead_time_std_days != null) override.leadTimeStdDays = r.lead_time_std_days;
      if (r.abc_class != null)
        override.abcClass = r.abc_class.trim() as SkuPolicy['abcClass'];
      if (r.target_doi != null) override.targetDoi = r.target_doi;
      if (r.safety_override != null) override.safetyOverride = r.safety_override;
      if (r.is_repairable != null) override.isRepairable = r.is_repairable;
      if (r.updated_by != null) override.updatedBy = r.updated_by;
      override.updatedAt = r.updated_at;

      map.set(r.sku_base, override);
    }
    return map;
  } catch (e) {
    console.error('[fetchSkuPolicies]', e instanceof Error ? e.message : e);
    return new Map();
  }
}
