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
  globalSettings: 'dev.fleet_global_settings',
  hubMaxStock: 'dev.fleet_sku_hub_max_stock',
  fleetSizeWeekly: 'dev.fleet_size_weekly',
  supplier: 'dev.fleet_supplier',
  skuSupplier: 'dev.fleet_sku_supplier',
  supplierModal: 'dev.fleet_supplier_modal',
  filterPreset: 'dev.fleet_filter_preset',
} as const;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.skuPolicy} (
    sku_base String,
    sku_name Nullable(String),
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
    pedido_name Nullable(String),
    order_type Nullable(String),
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
    prep_status Nullable(String),
    elaboration_snapshot Nullable(String),
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
    cpx Bool DEFAULT false,
    comfort Bool DEFAULT false,
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
    commercial_target_pct Nullable(Float64),
    churn_pct Nullable(Float64),
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

  // N shipping modals per supplier (VMoto: Courier 15d / Aéreo 45d / Marítimo 105d).
  // The SKU's effective lead comes from its preferred supplier's modals; the engine
  // plans across ALL of a supplier's modals (generalized air-bridge/sea-bulk).
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.supplierModal} (
    supplier_id String,
    modal_id String,
    name String,
    lead_days Int32,
    sort_order Int32 DEFAULT 0,
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (supplier_id, modal_id)`,

  // Named selection presets (custom filters): a saved list of sku_bases the team can
  // re-apply as the app-wide recorte with one click. Shared team-wide (Head writes).
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.filterPreset} (
    preset_id String,
    name String,
    skus String,
    note Nullable(String),
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY preset_id`,

  // Weekly REAL fleet size per model segment (stakeholder review item 2): the chart's
  // past becomes actuals and the projection anchors on the latest record. Fed weekly
  // by hand or via the end-of-month shortcut (homogeneous interpolation).
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.fleetSizeWeekly} (
    segment String,
    week_start Date,
    size Int32,
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (segment, week_start)`,

  // Supplier registry (backlog #21 — review 4b). Cadastro only — no engine change
  // (air is the emergency lane). kind = nacional | internacional.
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.supplier} (
    supplier_id String,
    name String,
    kind String DEFAULT 'internacional',
    contact Nullable(String),
    notes Nullable(String),
    lead_time_sea_days Nullable(Int32),
    lead_time_air_days Nullable(Int32),
    active Bool DEFAULT true,
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY supplier_id`,

  // SKU ↔ supplier link (composite key). is_preferred marks the default supplier used
  // to group "pedido por fornecedor"; priority orders the alternatives.
  `CREATE TABLE IF NOT EXISTS ${FLEET_TABLES.skuSupplier} (
    sku_base String,
    supplier_id String,
    is_preferred Bool DEFAULT false,
    priority Int32 DEFAULT 0,
    supplier_part_number Nullable(String),
    updated_by Nullable(String),
    updated_at DateTime64(3) DEFAULT now64(3),
    is_deleted Bool DEFAULT false
  ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (sku_base, supplier_id)`,
];

// Idempotent column adds for tables that already exist in prod (CREATE TABLE IF NOT
// EXISTS is a no-op once the table exists, so new columns need explicit ALTERs).
// ClickHouse's `ADD COLUMN IF NOT EXISTS` makes each safe to re-run every cold start.
const MIGRATIONS: string[] = [
  // B2: lead-time std deviation → combined-variance safety stock.
  `ALTER TABLE ${FLEET_TABLES.skuPolicy} ADD COLUMN IF NOT EXISTS lead_time_std_days Nullable(Int32)`,
  // B8: national vs. international purchase policy (editable override of the seed).
  `ALTER TABLE ${FLEET_TABLES.skuPolicy} ADD COLUMN IF NOT EXISTS is_national Nullable(Bool)`,
  // B6/D1: order-preparation lifecycle stage (elaborado → enviado → feito) preceding
  // the shipping status. Null = a normal/legacy order (sync/ingest/manual).
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS prep_status Nullable(String)`,
  // Compat model consolidation: two family flags (CPX / COMFORT) replacing the
  // per-variant columns. Legacy columns are left in place and folded in on read.
  `ALTER TABLE ${FLEET_TABLES.partCompat} ADD COLUMN IF NOT EXISTS cpx Bool DEFAULT false`,
  `ALTER TABLE ${FLEET_TABLES.partCompat} ADD COLUMN IF NOT EXISTS comfort Bool DEFAULT false`,
  // Manually-added SKUs carry their display name on the policy row (the warehouse
  // snapshot doesn't know a SKU that isn't in inventory yet).
  `ALTER TABLE ${FLEET_TABLES.skuPolicy} ADD COLUMN IF NOT EXISTS sku_name Nullable(String)`,
  // Stakeholder review (itens 7a/3b): pedido-level name + nacional/internacional type.
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS pedido_name Nullable(String)`,
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS order_type Nullable(String)`,
  // Item 8: frozen elaboration basis (forecast asOf, criteria, suggested vs chosen) per line.
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS elaboration_snapshot Nullable(String)`,
  // Backlog #21 — item 2 fase 2: meta comercial + churn (%/mês) na projeção de frota.
  `ALTER TABLE ${FLEET_TABLES.fleetInfo} ADD COLUMN IF NOT EXISTS commercial_target_pct Nullable(Float64)`,
  `ALTER TABLE ${FLEET_TABLES.fleetInfo} ADD COLUMN IF NOT EXISTS churn_pct Nullable(Float64)`,
  // Backlog #21 — item 4b: fornecedor vinculado ao pedido (para filtro/visão por fornecedor).
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS supplier_id Nullable(String)`,
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS supplier_name Nullable(String)`,
  // Lead time agora vive no fornecedor (mar/aéreo). O lead efetivo do SKU vem do
  // fornecedor preferido; sem fornecedor, cai no lead do próprio SKU.
  `ALTER TABLE ${FLEET_TABLES.supplier} ADD COLUMN IF NOT EXISTS lead_time_sea_days Nullable(Int32)`,
  `ALTER TABLE ${FLEET_TABLES.supplier} ADD COLUMN IF NOT EXISTS lead_time_air_days Nullable(Int32)`,
  // Notas P3: part number do fornecedor no vínculo SKU↔fornecedor (código do item no
  // catálogo do fornecedor) + no pedido (a linha carrega o part number usado).
  `ALTER TABLE ${FLEET_TABLES.skuSupplier} ADD COLUMN IF NOT EXISTS supplier_part_number Nullable(String)`,
  `ALTER TABLE ${FLEET_TABLES.purchaseOrder} ADD COLUMN IF NOT EXISTS part_number Nullable(String)`,
];

/** Idempotent — safe to call on every cold start; CREATE TABLE IF NOT EXISTS + ALTERs.
 *  CREATEs must succeed. ALTERs are best-effort: if the ClickHouse user lacks the ALTER
 *  grant, we don't fail the whole provisioning (new tables + seeds still land) — we
 *  return the skipped ALTERs so the caller can surface "grant ALTER to finish". */
export async function provisionFleetTables(): Promise<{ migrationErrors: string[] }> {
  for (const ddl of DDL) await chExecute(ddl);
  const migrationErrors: string[] = [];
  for (const alter of MIGRATIONS) {
    try {
      await chExecute(alter);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[provisionFleetTables] migration skipped:', msg);
      migrationErrors.push(msg);
    }
  }
  return { migrationErrors };
}

/** Read all live (non-deleted) rows from a fleet table, newest version per key. */
export async function readFleetTable<T = Row>(table: string): Promise<T[]> {
  return chQuery<T>(`SELECT * FROM ${table} FINAL WHERE is_deleted = 0`);
}

/** Build the escaped WHERE for readFleetRow. Column names are asserted against a strict
 *  identifier pattern (they're internal constants, never user input); values are
 *  single-quote-doubled — the same escaping convention as readAuditLog below.
 *  Exported for unit tests: a wrong/lossy match would make the caller see current=null
 *  and a subsequent full-row upsert would blank untouched columns. */
export function fleetRowWhere(where: Record<string, string>): string {
  const parts = Object.entries(where).map(([col, value]) => {
    if (!/^[a-z][a-z0-9_]*$/.test(col)) throw new Error(`Invalid fleet column name: ${col}`);
    return `${col} = '${String(value).replace(/'/g, "''")}'`;
  });
  if (parts.length === 0) throw new Error('readFleetRow requires at least one key column');
  return parts.join(' AND ');
}

/** Read ONE live row by key column(s) — replaces the "read the whole table, .find()
 *  one row" pattern in single-row server actions (a full FINAL scan per mutation). */
export async function readFleetRow<T = Row>(
  table: string,
  where: Record<string, string>,
): Promise<T | null> {
  const rows = await chQuery<T>(
    `SELECT * FROM ${table} FINAL WHERE is_deleted = 0 AND ${fleetRowWhere(where)} LIMIT 1`,
  );
  return rows[0] ?? null;
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
