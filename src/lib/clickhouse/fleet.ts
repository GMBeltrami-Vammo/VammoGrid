import 'server-only';
import { randomUUID } from 'crypto';
import { chExecute, chInsert, chQuery, type Row } from './reader';

// ─────────────────────────────────────────────────────────────────────────────
// The `fleet.*` config/state tables (formerly Supabase Postgres) — now
// `dev.fleet_*` in ClickHouse. See decisions.MD #11.
//
// ClickHouse has no row-level UPDATE/DELETE at OLTP speed, so every table here is
// ReplacingMergeTree(updated_at): a write is a fresh INSERT of the full row: the
// newest `updated_at` per primary key wins on read. Reads always go through
// `FINAL` (row counts here are tiny — under 1,000 rows total — so the perf cost
// of FINAL is a non-issue) and filter `is_deleted = 0`. Soft-delete = insert a new
// version with is_deleted = 1.
//
// Every write also appends a diff to `dev.fleet_audit_log` (append-only, plain
// MergeTree — never replaced) so "editable and logged" is one shared mechanism
// instead of a bespoke one per table.
// ─────────────────────────────────────────────────────────────────────────────

export const FLEET_TABLES = {
  skuPolicy: 'dev.fleet_sku_policy',
  purchaseOrder: 'dev.fleet_purchase_order',
  partCompat: 'dev.fleet_part_compat',
  fleetInfo: 'dev.fleet_info',
  jobRun: 'dev.fleet_job_run',
  auditLog: 'dev.fleet_audit_log',
  skuScope: 'dev.fleet_sku_scope',
  globalSettings: 'dev.fleet_global_settings',
  hubMaxStock: 'dev.fleet_sku_hub_max_stock',
} as const;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.skuPolicy} (
    sku_base String,
    lead_time_days Nullable(Int32),
    lead_time_source Nullable(String),
    abc_class Nullable(String),
    target_doi Nullable(Int32),
    recovery_rate Float64 DEFAULT 0,
    recovery_turnaround_days Int32 DEFAULT 14,
    safety_override Nullable(Float64),
    is_repairable Nullable(Bool),
    lead_time_sea_days Nullable(Int32),
    lead_time_air_days Nullable(Int32),
    default_modal String DEFAULT 'sea',
    lead_time_std_days Nullable(Int32),
    is_national Nullable(Bool),
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY sku_base`,

  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.purchaseOrder} (
    id String,
    vo Nullable(String),
    sku String,
    sku_name Nullable(String),
    qty_ordered Int32,
    order_date Date,
    eta Nullable(Date),
    lead_time_days Nullable(Int32),
    status String DEFAULT 'ordered',
    modal Nullable(String),
    hub_id String DEFAULT 'osasco',
    notes Nullable(String),
    source String DEFAULT 'manual',
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY id`,

  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.partCompat} (
    sku String,
    description Nullable(String),
    part_number Nullable(String),
    aplicacao Nullable(String),
    nacionalizado Bool DEFAULT false,
    cpx_preta Bool DEFAULT false,
    cpx_prata Bool DEFAULT false,
    cpx_cinza Bool DEFAULT false,
    cpx_azul Bool DEFAULT false,
    cpx_pro_azul Bool DEFAULT false,
    vs1_branco Bool DEFAULT false,
    vs2_preta Bool DEFAULT false,
    comfort_azul Bool DEFAULT false,
    comfort_v2_azul Bool DEFAULT false,
    updated_at DateTime64(3) DEFAULT now64(3),
    updated_by Nullable(String),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY sku`,

  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.fleetInfo} (
    segment String DEFAULT 'total',
    current_size Int32 DEFAULT 0,
    monthly_growth_rate Float64 DEFAULT 0,
    as_of_date Nullable(Date),
    updated_at DateTime64(3) DEFAULT now64(3),
    updated_by Nullable(String),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY segment`,

  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.jobRun} (
    job_name String,
    last_run_at DateTime64(3) DEFAULT now64(3),
    detail Nullable(String),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(last_run_at) ORDER BY job_name`,

  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.auditLog} (
    id String,
    entity_type String,
    entity_id String,
    field String,
    old_value Nullable(String),
    new_value Nullable(String),
    changed_by Nullable(String),
    changed_at DateTime64(3) DEFAULT now64(3)
  ) ENGINE = MergeTree() ORDER BY (entity_type, entity_id, changed_at)`,

  // The default visible SKU universe (sub-project A). `active` rows narrow every
  // analysis; the full catalog stays reachable via the "Lista completa" tab.
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.skuScope} (
    sku_base String,
    active Bool DEFAULT true,
    note Nullable(String),
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY sku_base`,

  // Generic key/value store for app-wide settings (sub-projects B1, E1): the active
  // service-level tier, fleet size/growth params, etc. `value` is a JSON string.
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.globalSettings} (
    key String,
    value String,
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY key`,

  // Per-SKU, per-hub maximum stock cap (sub-project B3). Visibility/alert only —
  // flags a hub whose on-hand exceeds its cap; does NOT clamp the purchase engine.
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.hubMaxStock} (
    sku_base String,
    hub_id String,
    max_qty Int32,
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (sku_base, hub_id)`,
];

// Idempotent column adds for tables that already exist in prod (CREATE TABLE IF NOT
// EXISTS is a no-op once the table exists, so new columns need explicit ALTERs).
// ClickHouse's `ADD COLUMN IF NOT EXISTS` makes each safe to re-run every cold start.
const MIGRATIONS: string[] = [
  // B2: lead-time std deviation → combined-variance safety stock.
  `ALTER TABLE ${FLEET_TABLES.skuPolicy} ADD COLUMN IF NOT EXISTS lead_time_std_days Nullable(Int32)`,
  // B8: national vs. international purchase policy (editable override of the seed).
  `ALTER TABLE ${FLEET_TABLES.skuPolicy} ADD COLUMN IF NOT EXISTS is_national Nullable(Bool)`,
];

/** Idempotent — safe to call on every cold start; CREATE TABLE IF NOT EXISTS + ALTERs. */
export async function provisionFleetTables(): Promise<void> {
  for (const ddl of DDL) await chExecute(ddl);
  for (const alter of MIGRATIONS) await chExecute(alter);
}

/** Read all live (non-deleted) rows from a fleet table, newest version per key. */
export async function readFleetTable<T = Row>(table: string): Promise<T[]> {
  return chQuery<T>(`SELECT * FROM ${table} FINAL WHERE is_deleted = 0`);
}

const IGNORED_DIFF_FIELDS = new Set(['updated_at', 'created_at', 'is_deleted']);

/**
 * Write a full row version (ReplacingMergeTree "update" = fresh insert) and log a
 * diff per changed field to the shared audit table. `current` is the row's
 * pre-write state (pass null for a brand-new row) — the caller reads it first so
 * this function can report what actually changed.
 */
export async function upsertFleetRow(args: {
  table: string;
  entityType: string;
  entityId: string;
  current: Row | null;
  next: Row;
  changedBy: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await chInsert(args.table, [{ ...args.next, updated_at: now, is_deleted: false }]);

  const fields = new Set([...Object.keys(args.current ?? {}), ...Object.keys(args.next)]);
  const auditRows: Row[] = [];
  for (const field of fields) {
    if (IGNORED_DIFF_FIELDS.has(field)) continue;
    const oldValue = args.current?.[field] ?? null;
    const newValue = args.next[field] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    auditRows.push({
      id: randomUUID(),
      entity_type: args.entityType,
      entity_id: args.entityId,
      field,
      old_value: oldValue != null ? JSON.stringify(oldValue) : null,
      new_value: newValue != null ? JSON.stringify(newValue) : null,
      changed_by: args.changedBy,
      changed_at: now,
    });
  }
  if (auditRows.length > 0) await chInsert(FLEET_TABLES.auditLog, auditRows);
}

/** Soft-delete: insert a new version of the row with is_deleted = true. */
export async function softDeleteFleetRow(args: {
  table: string;
  entityType: string;
  entityId: string;
  current: Row;
  changedBy: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await chInsert(args.table, [{ ...args.current, updated_at: now, is_deleted: true }]);
  await chInsert(FLEET_TABLES.auditLog, [
    {
      id: randomUUID(),
      entity_type: args.entityType,
      entity_id: args.entityId,
      field: 'is_deleted',
      old_value: 'false',
      new_value: 'true',
      changed_by: args.changedBy,
      changed_at: now,
    },
  ]);
}

/** Read the audit history for one entity, newest first. */
export async function readAuditLog(entityType: string, entityId: string): Promise<Row[]> {
  const safeType = entityType.replace(/'/g, "''");
  const safeId = entityId.replace(/'/g, "''");
  return chQuery<Row>(
    `SELECT * FROM ${FLEET_TABLES.auditLog}
     WHERE entity_type = '${safeType}' AND entity_id = '${safeId}'
     ORDER BY changed_at DESC`,
  );
}
