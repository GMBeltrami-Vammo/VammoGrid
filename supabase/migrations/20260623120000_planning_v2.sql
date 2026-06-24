-- ─────────────────────────────────────────────────────────────────────────────
-- VammoGrid 2.0 — Stock Planning & Logistics Platform
-- Additive, idempotent migration on the `fleet` schema. Safe to re-run.
-- Reads (stock, forecast, ledger, alerts) live in ClickHouse; this schema holds
-- only editable app metadata + business policy + plan audit.
--
-- NOT APPLIED automatically — review, then apply via the Supabase SQL editor / CLI,
-- or ask Claude to apply it to a Supabase branch via MCP.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists fleet;

-- 1. sku_policy — editable per-SKU planning policy (evolves legacy sku_params) ──
create table if not exists fleet.sku_policy (
  sku_base                 text primary key,
  lead_time_days           int  not null default 110,
  lead_time_source         text not null default 'international-default',
  abc_class                text not null default 'C',
  target_doi               int  not null default 60,
  recovery_rate            numeric not null default 0,
  recovery_turnaround_days int  not null default 14,
  safety_override          numeric,
  is_repairable            boolean not null default false,
  updated_by               text,
  updated_at               timestamptz not null default now()
);

-- Backfill from legacy sku_params if it exists (guarded).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'fleet' and table_name = 'sku_params') then
    insert into fleet.sku_policy
      (sku_base, lead_time_days, abc_class, target_doi, recovery_rate, recovery_turnaround_days, updated_by, updated_at)
    select sku,
           coalesce(lead_time_days, 110),
           coalesce(abc_class, 'C'),
           coalesce(target_doi, 60),
           coalesce(recovery_rate, 0),
           coalesce(recovery_lookback_days, 14),
           updated_by,
           coalesce(updated_at, now())
    from fleet.sku_params
    on conflict (sku_base) do nothing;
  end if;
end $$;

-- 2. purchase_order — evolve in place (additive; keep table name) ──────────────
alter table fleet.purchase_order add column if not exists sku_base text;
alter table fleet.purchase_order add column if not exists reconciled_received boolean not null default false;
update fleet.purchase_order
   set sku_base = array_to_string((string_to_array(sku, '-'))[1:4], '-')
 where sku_base is null;

-- 3. hub — hub ⇄ IMS location mapping + map coords ────────────────────────────
create table if not exists fleet.hub (
  id          text primary key,
  name        text not null,
  location_id int  not null,
  is_central  boolean not null default false,
  lat         double precision,
  lng         double precision
);
insert into fleet.hub (id, name, location_id, is_central, lat, lng) values
  ('osasco', 'Osasco', 34, true, -23.5329, -46.7916),
  ('mooca',  'Mooca', 1, false, -23.5705, -46.6005),
  ('sbc',    'São Bernardo do Campo', 166, false, -23.6914, -46.5646)
on conflict (id) do update
  set name = excluded.name, location_id = excluded.location_id,
      is_central = excluded.is_central, lat = excluded.lat, lng = excluded.lng;

-- 4. transfer_constraint — per route policy ───────────────────────────────────
create table if not exists fleet.transfer_constraint (
  from_hub    text not null,
  to_hub      text not null,
  enabled     boolean not null default true,
  transit_days int not null default 1,
  min_qty     int not null default 1,
  cadence     text not null default 'weekly',
  primary key (from_hub, to_hub)
);
insert into fleet.transfer_constraint (from_hub, to_hub, transit_days, min_qty) values
  ('osasco', 'mooca', 1, 1),
  ('osasco', 'sbc', 2, 1)
on conflict (from_hub, to_hub) do nothing;

-- 5. forecast_override — manual demand adjustments ────────────────────────────
create table if not exists fleet.forecast_override (
  id          bigint generated always as identity primary key,
  sku_base    text not null,
  start_date  date not null,
  end_date    date not null,
  multiplier  numeric,
  value       numeric,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- 6. plan_run / plan_line — weekly suggestion audit + approval ─────────────────
create table if not exists fleet.plan_run (
  id         bigint generated always as identity primary key,
  kind       text not null,                -- 'transfer' | 'purchase'
  cycle_date date not null,
  created_by text,
  created_at timestamptz not null default now()
);
create table if not exists fleet.plan_line (
  id         bigint generated always as identity primary key,
  run_id     bigint not null references fleet.plan_run(id) on delete cascade,
  sku_base   text not null,
  line_type  text not null,                -- 'transfer' | 'purchase'
  payload    jsonb not null,
  status     text not null default 'suggested', -- suggested|approved|rejected|executed
  updated_at timestamptz not null default now()
);

-- 7. RLS — read for anon/authenticated; writes go through the service-role key ─
do $$
declare t text;
begin
  foreach t in array array[
    'sku_policy','hub','transfer_constraint','forecast_override','plan_run','plan_line'
  ] loop
    execute format('alter table fleet.%I enable row level security;', t);
    execute format(
      'drop policy if exists %I on fleet.%I;', t || '_read', t);
    execute format(
      'create policy %I on fleet.%I for select using (true);', t || '_read', t);
  end loop;
end $$;

-- 8. KEEP fleet.piece_stock_hub — it is the PER-HUB daily history source (the
-- warehouse mart only keeps network totals, so per-hub history must come from here).
-- The daily snapshot cron repopulates it (~09:00 UTC). The projection/SKU charts read
-- it for true per-hub history (D-30). Only piece_stock_hub_monthly is currently unused;
-- left in place, can be retired later if confirmed.
-- (No drops — retirement reversed once per-hub history was confirmed to live here.)
