import 'server-only';
import { chInsert } from '@/lib/clickhouse/reader';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { fetchRecoveryRates } from './source/recovery';

// Weekly job: refresh per-SKU recovery rates from the IMS ledger (observed
// RECONDITION ÷ USAGE over the trailing 90 days) into dev.fleet_sku_policy
// (formerly Supabase fleet.sku_policy — see decisions.MD #11).
//
//   • Only SKUs with actual reconditioning (recovered > 0) are written.
//   • An observed rate > 100% is a reconditioning-backlog artifact → defaults to 0
//     (don't assume full recovery from noisy/timing data).
//   • Manual overrides (updated_by is a human email) are preserved, never clobbered.
//   • recovery_turnaround_days stays at its default (14 on insert) / existing value.
//
// Triggered by /api/recovery/refresh (Vercel weekly cron). Records its run time in
// dev.fleet_job_run so the UI can show "última atualização".

const JOB_NAME = 'recovery-refresh';
const OWNER = 'cron:ims-recovery';

interface PolicyRow {
  sku_base: string;
  updated_by: string | null;
  [key: string]: unknown;
}

export async function refreshRecoveryRates(): Promise<{ updated: number; skipped: number }> {
  const observed = await fetchRecoveryRates();

  // Preserve manual edits: skip SKUs whose policy was last touched by a human.
  const existing = await readFleetTable<PolicyRow>(FLEET_TABLES.skuPolicy);
  const currentBySku = new Map(existing.map((r) => [r.sku_base, r]));
  const manual = new Set(
    existing.filter((r) => (r.updated_by ?? '').includes('@')).map((r) => r.sku_base),
  );

  const now = new Date().toISOString();
  let skipped = 0;
  const rows: Record<string, unknown>[] = [];

  for (const [skuBase, obs] of observed) {
    if (obs.recovered <= 0) continue; // no reconditioning observed → not recoverable
    if (manual.has(skuBase)) {
      skipped++;
      continue;
    }
    const rate = obs.rate > 1 ? 0 : Math.round(obs.rate * 10000) / 10000;
    const current = currentBySku.get(skuBase);
    rows.push({
      // Carry over the rest of the row (lead times, abc_class, etc.) — this is a
      // full-row write (ReplacingMergeTree), not a partial column update.
      ...current,
      sku_base: skuBase,
      recovery_rate: rate,
      recovery_turnaround_days: current?.recovery_turnaround_days ?? 14,
      is_repairable: true,
      updated_by: OWNER,
      updated_at: now,
      is_deleted: false,
    });
  }

  if (rows.length) {
    await chInsert(FLEET_TABLES.skuPolicy, rows);
  }

  await chInsert(FLEET_TABLES.jobRun, [
    {
      job_name: JOB_NAME,
      last_run_at: now,
      detail: JSON.stringify({
        skus: rows.length,
        skipped,
        source: 'ims-ledger-90d',
        rule: 'rate>1->0',
      }),
      is_deleted: false,
    },
  ]);

  return { updated: rows.length, skipped };
}

/** Last time the recovery refresh job ran (ISO timestamp), or null. */
export async function fetchRecoveryRefreshedAt(): Promise<string | null> {
  try {
    const rows = await readFleetTable<{ job_name: string; last_run_at: string }>(
      FLEET_TABLES.jobRun,
    );
    return rows.find((r) => r.job_name === JOB_NAME)?.last_run_at ?? null;
  } catch (e) {
    console.error('[fetchRecoveryRefreshedAt]', e instanceof Error ? e.message : e);
    return null;
  }
}
