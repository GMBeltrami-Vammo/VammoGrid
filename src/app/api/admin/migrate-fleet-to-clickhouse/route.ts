import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createServiceSupabase } from '@/lib/supabase/service';
import { chInsert, type Row } from '@/lib/clickhouse/reader';
import { FLEET_TABLES, provisionFleetTables } from '@/lib/clickhouse/fleet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// ONE-OFF migration: copy the 5 live fleet.* Supabase tables into their
// dev.fleet_* ClickHouse equivalents (decisions.MD #11). Meant to be triggered
// once, verified, then deleted from the codebase — not a standing endpoint.
//
// purchase_order.id moves from a Postgres bigint sequence to an app-generated
// UUID (ClickHouse has no sequences); nothing external depends on the exact old
// numeric value (the stable business key is `vo`, not `id`), so a fresh UUID per
// row is safe. fleet_info was empty (0 rows) — table is provisioned, nothing to copy.
// ─────────────────────────────────────────────────────────────────────────────

function toChDate(v: string | null | undefined): string | null {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function toChDateTime(v: string | null | undefined): string {
  const d = v ? new Date(v) : new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

async function runMigration(req: Request) {
  if (process.env.CRON_SECRET) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    const validCron = bearer === process.env.CRON_SECRET?.trim();
    const session = await auth();
    if (!validCron && !session?.user?.isHead) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    await provisionFleetTables();
    const supabase = createServiceSupabase();
    const counts: Record<string, number> = {};

    // sku_policy
    {
      const { data, error } = await supabase.schema('fleet').from('sku_policy').select('*');
      if (error) throw new Error(`sku_policy read: ${error.message}`);
      const rows: Row[] = (data ?? []).map((r) => ({
        sku_base: r.sku_base,
        lead_time_days: r.lead_time_days,
        lead_time_source: r.lead_time_source,
        abc_class: r.abc_class,
        target_doi: r.target_doi,
        recovery_rate: Number(r.recovery_rate) || 0,
        recovery_turnaround_days: Number(r.recovery_turnaround_days) || 14,
        safety_override: r.safety_override != null ? Number(r.safety_override) : null,
        is_repairable: r.is_repairable,
        lead_time_sea_days: r.lead_time_sea_days,
        lead_time_air_days: r.lead_time_air_days,
        default_modal: r.default_modal ?? 'sea',
        updated_by: r.updated_by,
        updated_at: toChDateTime(r.updated_at),
        is_deleted: false,
      }));
      await chInsert(FLEET_TABLES.skuPolicy, rows);
      counts.sku_policy = rows.length;
    }

    // purchase_order (fresh UUID ids)
    {
      const { data, error } = await supabase.schema('fleet').from('purchase_order').select('*');
      if (error) throw new Error(`purchase_order read: ${error.message}`);
      const rows: Row[] = (data ?? []).map((r) => ({
        id: crypto.randomUUID(),
        vo: r.vo,
        sku: r.sku,
        sku_name: r.sku_name,
        qty_ordered: Number(r.qty_ordered) || 0,
        order_date: toChDate(r.order_date),
        eta: toChDate(r.eta),
        lead_time_days: r.lead_time_days,
        status: r.status ?? 'ordered',
        modal: r.modal,
        hub_id: r.hub_id ?? 'osasco',
        notes: r.notes,
        source: r.source ?? 'manual',
        created_at: toChDateTime(r.created_at),
        updated_at: toChDateTime(r.updated_at),
        is_deleted: false,
      }));
      await chInsert(FLEET_TABLES.purchaseOrder, rows);
      counts.purchase_order = rows.length;
    }

    // part_compat
    {
      const { data, error } = await supabase.schema('fleet').from('part_compat').select('*');
      if (error) throw new Error(`part_compat read: ${error.message}`);
      const rows: Row[] = (data ?? []).map((r) => ({
        sku: r.sku,
        description: r.description,
        part_number: r.part_number,
        aplicacao: r.aplicacao,
        nacionalizado: Boolean(r.nacionalizado),
        cpx_preta: Boolean(r.cpx_preta),
        cpx_prata: Boolean(r.cpx_prata),
        cpx_cinza: Boolean(r.cpx_cinza),
        cpx_azul: Boolean(r.cpx_azul),
        cpx_pro_azul: Boolean(r.cpx_pro_azul),
        vs1_branco: Boolean(r.vs1_branco),
        vs2_preta: Boolean(r.vs2_preta),
        comfort_azul: Boolean(r.comfort_azul),
        comfort_v2_azul: Boolean(r.comfort_v2_azul),
        updated_at: toChDateTime(r.updated_at),
        updated_by: r.updated_by,
        is_deleted: false,
      }));
      await chInsert(FLEET_TABLES.partCompat, rows);
      counts.part_compat = rows.length;
    }

    // fleet_info (0 rows today — table provisioned regardless)
    {
      const { data, error } = await supabase.schema('fleet').from('fleet_info').select('*');
      if (error) throw new Error(`fleet_info read: ${error.message}`);
      const rows: Row[] = (data ?? []).map((r) => ({
        segment: r.segment ?? 'total',
        current_size: Number(r.current_size) || 0,
        monthly_growth_rate: Number(r.monthly_growth_rate) || 0,
        as_of_date: toChDate(r.as_of_date),
        updated_at: toChDateTime(r.updated_at),
        updated_by: r.updated_by,
        is_deleted: false,
      }));
      await chInsert(FLEET_TABLES.fleetInfo, rows);
      counts.fleet_info = rows.length;
    }

    // job_run
    {
      const { data, error } = await supabase.schema('fleet').from('job_run').select('*');
      if (error) throw new Error(`job_run read: ${error.message}`);
      const rows: Row[] = (data ?? []).map((r) => ({
        job_name: r.job_name,
        last_run_at: toChDateTime(r.last_run_at),
        detail: r.detail != null ? JSON.stringify(r.detail) : null,
        is_deleted: false,
      }));
      await chInsert(FLEET_TABLES.jobRun, rows);
      counts.job_run = rows.length;
    }

    return NextResponse.json({ ok: true, copied: counts, at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/admin/migrate-fleet-to-clickhouse]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — visit the URL directly while logged in as a Head (no need to know the
// Vercel CRON_SECRET value). POST — curl with the CRON_SECRET bearer header.
export const GET = runMigration;
export const POST = runMigration;
