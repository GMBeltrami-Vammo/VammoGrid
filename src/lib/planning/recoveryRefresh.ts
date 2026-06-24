import 'server-only';
import { createServiceSupabase } from '@/lib/supabase/service';
import { fetchRecoveryRates } from './source/recovery';

// Weekly job: refresh per-SKU recovery rates from the IMS ledger (observed
// RECONDITION ÷ USAGE over the trailing 90 days) into fleet.sku_policy.
//
//   • Only SKUs with actual reconditioning (recovered > 0) are written.
//   • An observed rate > 100% is a reconditioning-backlog artifact → defaults to 0
//     (don't assume full recovery from noisy/timing data).
//   • Manual overrides (updated_by is a human email) are preserved, never clobbered.
//   • recovery_turnaround_days stays at its default (14 on insert) / existing value.
//
// Triggered by /api/recovery/refresh (Vercel weekly cron). Records its run time in
// fleet.job_run so the UI can show "última atualização".

const JOB_NAME = 'recovery-refresh';
const OWNER = 'cron:ims-recovery';

export async function refreshRecoveryRates(): Promise<{ updated: number; skipped: number }> {
  const observed = await fetchRecoveryRates();
  const supabase = createServiceSupabase();

  // Preserve manual edits: skip SKUs whose policy was last touched by a human.
  const { data: existing } = await supabase
    .schema('fleet')
    .from('sku_policy')
    .select('sku_base, updated_by');
  const manual = new Set(
    (existing ?? [])
      .filter((r) => (r.updated_by ?? '').includes('@'))
      .map((r) => r.sku_base as string),
  );

  const now = new Date().toISOString();
  let skipped = 0;
  const rows: {
    sku_base: string;
    recovery_rate: number;
    is_repairable: boolean;
    updated_by: string;
    updated_at: string;
  }[] = [];

  for (const [skuBase, obs] of observed) {
    if (obs.recovered <= 0) continue; // no reconditioning observed → not recoverable
    if (manual.has(skuBase)) {
      skipped++;
      continue;
    }
    const rate = obs.rate > 1 ? 0 : Math.round(obs.rate * 10000) / 10000;
    rows.push({
      sku_base: skuBase,
      recovery_rate: rate,
      is_repairable: true,
      updated_by: OWNER,
      updated_at: now,
    });
  }

  if (rows.length) {
    const { error } = await supabase
      .schema('fleet')
      .from('sku_policy')
      .upsert(rows, { onConflict: 'sku_base' });
    if (error) throw new Error(error.message);
  }

  const { error: jobErr } = await supabase
    .schema('fleet')
    .from('job_run')
    .upsert(
      {
        job_name: JOB_NAME,
        last_run_at: now,
        detail: { skus: rows.length, skipped, source: 'ims-ledger-90d', rule: 'rate>1->0' },
      },
      { onConflict: 'job_name' },
    );
  if (jobErr) throw new Error(jobErr.message);

  return { updated: rows.length, skipped };
}

/** Last time the recovery refresh job ran (ISO timestamp), or null. */
export async function fetchRecoveryRefreshedAt(): Promise<string | null> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .schema('fleet')
      .from('job_run')
      .select('last_run_at')
      .eq('job_name', JOB_NAME)
      .maybeSingle();
    if (error || !data) return null;
    return (data.last_run_at as string) ?? null;
  } catch {
    return null;
  }
}
