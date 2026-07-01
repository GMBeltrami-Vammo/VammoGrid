# VammoGrid — Order-Orchestration Platform

## Context

VammoGrid today answers "what's my stock, DOH, and purchase suggestion, per SKU?" — a
visibility layer. This spec evolves it into a platform for actually *running*
procurement: editable business parameters (with an audit trail), a redesigned
weekly view modeled on a reference tool ("Pablo's HTML"), an order-drafting
workflow, and a restricted default SKU universe with a full-catalog escape hatch.

Reference file analyzed: `Spare Parts Bike - June.html` ("Days on Hand · v100"), a
standalone planning dashboard — not part of this codebase, but the model for the
Semanas/heatmap redesign (sub-project C) and the source of the default SKU scope
(sub-project A).

**Architecture note that changed mid-design:** this spec originally assumed new
editable parameters would live in Supabase, matching the app's existing pattern at
the time. Supabase has since been **fully removed** from VammoGrid (decisions.MD
#11) — the `fleet.*` config tables it used to hold now live in ClickHouse as
`dev.fleet_*` (`ReplacingMergeTree(updated_at)` + soft-delete, written through
`upsertFleetRow()`/`softDeleteFleetRow()`, read through `readFleetTable()`, all in
`src/lib/clickhouse/fleet.ts`, with every change logged to the shared
`dev.fleet_audit_log`). **Every new table in this spec targets ClickHouse, not
Supabase** — there is no Supabase left in this app to target.

## Locked decisions (resolved via Q&A before this spec was written)

| Decision | Answer |
|---|---|
| Deliverable now | Spec + plan only — no implementation until this spec is approved (brainstorming skill's hard gate) |
| Default SKU universe | 139 unique codes from the reference file (one corrupted entry — `sku` field held an item name instead of a code — resolved to the existing `VM-01-FRE0-1016` row, making it a duplicate, not a 140th SKU) |
| Global floor-level labels | **Base / Padrão / Conservador** (95% / 97% / 99%), not lettered A/B/C — the existing per-SKU `AbcClass` (`A`/`B`/`C`, importance tier, drives target-DOI) already uses those letters for a different concept; reusing them for this new *global* service-level dial would collide |
| Recommended build order | A → B → D → C → E → F → G (each reuses the previous step's output) |

## Cross-cutting decisions

1. **No Supabase, anywhere, for anything new.** All new state is ClickHouse
   `dev.fleet_*`, following the exact pattern the migration established.
2. **One shared audit log**, not one per feature: every write goes through
   `upsertFleetRow()` (full-row write + per-field diff into `dev.fleet_audit_log`)
   or `softDeleteFleetRow()`. This is what makes "editable and logged" a single
   reusable mechanism instead of N bespoke ones.
3. **New table DDL lives in `src/lib/clickhouse/fleet.ts`** alongside the existing
   five — add to the `FLEET_TABLES` map and the `DDL` array, not a new file per
   table. Keep tables `dev.fleet_`-prefixed for visual grouping against the
   ML/ETL tables (`dev.sop_predictions_daily`, `dev.vmoto_orders`).
4. **Browser never talks to ClickHouse directly.** Any new client-side read goes
   through a server-side `/api/fleet/*` proxy route (established pattern —
   `purchase-orders`/`part-compat`/`fleet-info` already exist), same as the
   existing hooks.
5. **Row counts stay tiny** (low hundreds per table) — `SELECT ... FINAL` is not
   a performance concern here, same reasoning as the existing five tables.

---

## Sub-project A — SKU universe scoping

**Problem:** every page should default to showing only the 139 reference SKUs,
with a "full catalog" escape hatch, and every analysis (stock, DOH, projections)
should respect that default.

**Reuse, not rebuild:** the app already has the two pieces this needs:
- `PlanningFilter.skus` (`src/lib/planning/filter.ts`) — a cookie-persisted,
  user-editable hand-picked SKU set that narrows every page.
- `/dashboard/skus?ignoreSkuSelection=true` — already the unfiltered full-catalog
  view (`safeComputeSnapshot(true)` bypasses all narrowing).

**Gap:** today's narrowing is a *personal, ad-hoc* cookie pick (default = show
everything), not a *shared, admin-managed default scope*. Two changes:

1. New table `dev.fleet_sku_scope` (`sku_base String, active Bool DEFAULT true,
   note Nullable(String), updated_by Nullable(String), updated_at DateTime64(3),
   is_deleted Bool`) — seeded with the 139 codes via a one-off migration route
   (same pattern as the Supabase→ClickHouse migration: build it, run it once,
   verify row count, delete it).
2. `safeComputeSnapshot()` (`src/lib/planning/load.ts`) narrows to the active
   scope set *before* applying the user's ad-hoc cookie filter, unless
   `ignoreSkuSelection` is set. The cookie mechanism (100-SKU cap) stays reserved
   for the user's *further* narrowing on top of the scope, not for holding the
   scope itself — 139 codes would eat most of that cap.
3. A small admin UI (add/remove SKUs from the scope, `isHead`-gated) — a new
   tab, most naturally on the existing `/dashboard/skus` full-catalog page,
   which becomes explicitly the "full SKU list" escape hatch and doubles as the
   scope manager.

**Files:** `src/lib/clickhouse/fleet.ts` (new table), new migration route (temporary),
`src/lib/planning/load.ts` (scope filter step), `src/lib/planning/filter.ts` (doc
comment update — cookie is now a delta on top of scope, not the whole picture),
`src/app/dashboard/skus/page.tsx` + a new scope-editing component.

---

## Sub-project B — Purchasing policy engine

The core piece everything else builds on.

**Global floor tiers (Base 95% / Padrão 97% / Conservador 99%).** New table
`dev.fleet_global_settings` (`key String, value String /* JSON */, updated_by
Nullable(String), updated_at DateTime64(3), is_deleted Bool`) — a generic
key/value store, reused by sub-projects E and (optionally) C's horizon config
too. Key `service_level_tier` holds the active tier; switching it recalculates
every SKU's floor instantly (z = 1.645/1.881/2.326, same mapping as the
reference file's 95/97/99% buttons).

**Lead-time standard deviation.** Genuinely new — even the reference file
treats lead time as a fixed constant. Add `lead_time_std_days Nullable(Int32)`
to `dev.fleet_sku_policy`. When set, extend `purchaseForSku()`
(`src/lib/planning/purchase.ts:101`) from the current demand-only safety formula
to the standard combined-variance form:

```
σ = √( L̄·σ_demand² + demand̄²·σ_LT² )
```

instead of `safety = ABC_Z[abcClass] * sigmaL` (or the global-tier z, once B
ships). When `lead_time_std_days` is unset, `σ_LT = 0` and the formula collapses
to today's behavior exactly — no regression for SKUs that haven't been given
this new input yet.

**Max stock per hub.** New table `dev.fleet_sku_hub_max_stock` (`sku_base
String, hub_id String, max_qty Int32, updated_by Nullable(String), updated_at
DateTime64(3), is_deleted Bool`, ORDER BY `(sku_base, hub_id)`). V1 is
**visibility + alert only** — flag when a hub's on-hand exceeds its cap. It does
**not** clamp the purchase engine's order-quantity math in this pass; that's a
separate, riskier change deserving its own validation, not a side effect of a
config screen.

**National vs. international purchase policy.** Mostly already modeled
(`leadTimeSource`, sea/air split in `SkuPolicy`) — the gap is that
`NATIONAL_LEAD_TIMES` (`src/lib/planning/seed/nationalLeadTimes.ts`) is a
hardcoded seed file, not an editable value. Add an `is_national Bool` column to
`dev.fleet_sku_policy`; surface it as a toggle in the (existing) Lead Times page,
so an override replaces the seed rather than requiring a code change.

**Reorder point in DOH.** Trivial: add `ropDoh: number | null` to
`PurchaseSuggestion` (`src/types/planning.ts`) = `rop / dailyDemand`, computed
in `purchaseForSku()`, surfaced next to the existing unit-based ROP wherever
it's shown. This is the existing **statistical** ROP (z·σ·√LT) — an analytical
health indicator, unchanged, still driving the CRITICAL/REORDER/OK badge on the
SKU tables and Estoque page. It stays as-is; it does not feed the new rule below.

**Elaboration-trigger rule (new — this is what actually decides when a pedido
gets drafted).** A separate, simpler, forward-looking rule, distinct from the
statistical ROP above: scan the SKU's *entire* projected stock timeline
(`ProjectionPoint[]` from `projectSku()`, already computed) for the first day
where `DOH(d) = stock(d)/demand(d)` drops below **75**. If none exists in the
horizon, no action. If one does, that SKU needs a new order — the only question
is which modal:

- **Maritime is the default.** Sea orders are placed on a **fixed monthly
  batch** (the 1st of the month) — not continuously, matching real
  container-consolidation economics. `nextSeaOrderDate(today)` = today if
  today is the 1st, else the 1st of next month. `seaArrival = nextSeaOrderDate
  + leadTimeSeaDays` (110d default).
- **Air has no calendar constraint** — it can be ordered the same day, any day.
  `airArrival = today + leadTimeAirDays` (40d default, or the SKU's own).
- **Decision:** if `seaArrival` is still in time to prevent the breach (≤ the
  first-breach date), draft the order **maritime**. Otherwise — the monthly
  batching would arrive too late — draft it **air** ("aéreo se necessário,
  senão marítimo," exactly as specified). If even air can't make it in time,
  still draft air (best available) but flag the pedido as late/critical rather
  than silently treating it as resolved.

This rule is what actually creates a `dev.fleet_purchase_order` row with
`prep_status = 'elaborado'` (sub-project D) — modal pre-filled by the decision
above, editable by a human before it moves to `enviado`.

**Compras (procurement) page — built around this rule.** This is the real
purpose of the elaboration rule, not a side effect: `/dashboard/procurement`
becomes the page where it's applied.
- **Monthly automated pass**, mirroring the existing daily orders-sync /
  weekly recovery-refresh cron pattern: a new scheduled job runs the rule
  across every in-scope SKU (respecting A's scope) around the sea-ordering
  window and auto-drafts `elaborado` pedidos as needed.
- **On-demand re-check**, exposed as a button in the UI (per-SKU or
  catalog-wide) — since air has no calendar constraint, a human should be able
  to re-run the rule anytime mid-month without waiting for the next automated
  pass, e.g. after a demand spike.
- Filter chips (status, modal, hub, national vs. international), CSV export,
  and inline editing of `safetyOverride` (already a `SkuPolicy` field) — same
  table/edit patterns already used elsewhere, no new data model for these.

**Files:** `src/lib/clickhouse/fleet.ts` (2 new tables + 1 new column on
`sku_policy`'s DDL — note: ClickHouse `ALTER TABLE ADD COLUMN` for existing
tables, not a fresh `CREATE TABLE`), `src/lib/planning/purchase.ts`
(combined-variance formula; a new `findElaborationTrigger()` pure function for
the DOH<75 scan + modal decision, alongside — not replacing —
`purchaseForSku()`), `src/types/planning.ts` (`ropDoh`, `leadTimeStdDays`), new
Server Actions for the two new tables, a new monthly cron route (e.g.
`/api/procurement/elaborate`), `/dashboard/procurement` (rebuilt around the
trigger rule — filters/export/re-check button), `/dashboard/lead-times`
(national toggle).

---

## Sub-project C — Semanas/heatmap redesign

Extends the existing `buildWeekGrid()` (`src/lib/planning/weekgrid.ts`) rather
than replacing it — the grid, scope toggle, and buy-by flagging it already does
stay; this adds the reference file's heatmap semantics on top.

- **`scenario` param** (`baseline` / `air_only` / `sea_only` / `complete`):
  inject a hypothetical air or sea shipment at that modal's lead time and
  recompute — this is literally "cobertura do pedido aéreo e marítimo."
  Implementation: `buildWeekGrid()` gains an optional `injectedOrder` per scope
  that's added to the same `orders` array `projectSku()` already consumes — no
  new engine concept, just an extra synthetic `OpenPurchaseOrder`.
- **Floor tier** (from B) drives the cell-coloring threshold — same
  `doh_floor95/97/99`-style per-SKU thresholds as the reference file, computed
  from the same z-score formula B introduces.
- **Heat-filter** (all / marítimo / aéreo / pré-sea-30d / crítico): a client-side
  row filter over fields already on `WeekGridRow` (status, `defaultModal`,
  `buyByWeekIdx`) — no new data needed.
- **Horizon**: `buildWeekGrid()` already takes a `weeks` param; expose it as a UI
  selector. Cells beyond the real forecast horizon (~90-150d) get the existing
  `extrapolated` flag from `ProjectionPoint` so a flat extrapolation never reads
  as a real forecast.
- **DOH↔units toggle**: free — `WeekCell` already carries both `stock` and
  `doh`.
- **Cross-links**: SKU cells → `/dashboard/estoque?sku=...` (existing pattern);
  cells covered by a real shipment → `/dashboard/pedidos/[vo]` (new, see D).

**Files:** `src/lib/planning/weekgrid.ts` (scenario injection, floor param),
`src/components/planning/WeekGridView.tsx` (scenario/floor/filter/horizon
controls, unit toggle).

---

## Sub-project D — Order-orchestration workflow

`dev.fleet_purchase_order` + `PurchaseOrdersPanel` already cover the
shipping-lifecycle status (`ordered → in_transit → customs → received`). Two
gaps: the *earlier* drafting stage, and a proper per-order detail view.

**Preparation stage.** Add `prep_status Nullable(String)` (`elaborado` /
`enviado` / `feito`) to `dev.fleet_purchase_order` — an `ALTER TABLE ADD
COLUMN`, not a new table. A pedido starts as a draft row (`prep_status =
'elaborado'`, no `vo` yet, no `eta` yet); once `feito`, it gets a real `vo` and
the existing shipping lifecycle takes over. One continuous timeline instead of
two disconnected status fields.

**Pedido detail window** (explicit user ask: "open a pedido in a window, seeing
its history, skus - quantities ordered, status, ETA"). No schema split needed —
a pedido today is already just several `dev.fleet_purchase_order` rows sharing
one `vo` value (one row per SKU line, confirmed against the reference file's
own VO/shipment shape). Design:
- `/dashboard/pedidos/[vo]` as a Next.js **intercepting route**: clicking a
  pedido from the list opens it as a modal overlay (the "window"); direct
  navigation or refresh renders the same content as a full page. Gives every
  SKU↔order cross-link a stable, shareable target.
- The window groups the flat rows by `vo` (falling back to `id` for manual
  single-line orders without a VO yet) into a header (total qty, SKU count,
  modal, aggregate status) + a line-item table (sku, qty, status, eta), reusing
  `OrderEditor` for inline edits.
- **History tab** = `readAuditLog('purchase_order', <row id>)` (already exists,
  `src/lib/clickhouse/fleet.ts`) for every row in the group, merged and sorted
  into one timeline. No new logging mechanism — this is exactly what the
  existing shared audit log is for.

**Filters/export/manual adjustments** on the Pedidos list mirror B's procurement
filters (status, modal, hub, national/international) — same pattern, applied to
`dev.fleet_purchase_order` instead of the purchase-suggestion view.

Assumption carried over from the original design discussion: Pedidos stays
**unaffected by A's SKU-scope restriction** — you can still see and manage
orders for out-of-scope SKUs, since receiving/tracking a shipment isn't a
"stock analysis."

**Files:** `src/lib/clickhouse/fleet.ts` (`prep_status` column),
`src/app/dashboard/pedidos/[vo]/page.tsx` (new, + intercepting-route variant),
`src/app/dashboard/pedidos/actions.ts` (prep-status transitions), a new
`PedidoDetail` component (header + line items + history tab).

---

## Sub-project E — Fleet size & growth prediction

New `dev.fleet_global_settings` keys (same table as B): `fleet_size_current`
(int), `fleet_growth_rate_monthly_pct` (numeric), `fleet_growth_effective_from`
(date). A small pure function projects the weekly fleet-size curve
(compounding, configurable rate) — a visibility panel shows current size +
projected curve.

Note: the reference file hardcodes absolute monthly bike-model additions
(CPX frozen, all growth to COMFORT) rather than a steady rate — the user's ask
for a *configurable steady rate* is deliberately simpler than that, not a
port of it.

**Deliberately out of scope for this pass:** wiring the growth rate into the ML
demand forecast (`dev.sop_predictions_daily`). That's a forecasting-model
change and deserves its own validation, not a side effect of a config screen —
same boundary as B's max-stock alert-only decision.

**Files:** `src/lib/clickhouse/fleet.ts` (keys, no new table), new pure function
in `src/lib/planning/` (fleet-growth projection), a new visibility panel
(likely on Visão Geral or its own small page).

---

## Sub-project F — Frota data entry

Per the user's own framing ("frota provavelmente feita na mão"), this is a
manual ledger, not a derived value: two new tables, `dev.fleet_bike_sales_log`
and `dev.fleet_bike_order_log` (`date Date, model String, qty Int32, note
Nullable(String), created_by Nullable(String), created_at DateTime64(3),
is_deleted Bool`). A simple add-row UI, `isHead`-gated. The running total feeds
E's fleet-size-growth panel as its starting point. "Logs" = the shared audit
table, same as everywhere else — no separate logging concept needed.

**Files:** `src/lib/clickhouse/fleet.ts` (2 new tables), new Server Actions, new
small "Frota" data-entry page/panel.

---

## Sub-project G — Backlog / motos paradas

New table `dev.fleet_backlog_bike_log` (`id String, model String,
stalled_since Date, reason Nullable(String), status String /* parado |
em_reparo | reativado */, resolved_at Nullable(Date), notes Nullable(String),
created_by Nullable(String), created_at DateTime64(3), updated_at
DateTime64(3), is_deleted Bool`) — a searchable, status-filterable registry
("procurar registros").

**Consumption-impact prediction reuses C's scenario mechanism** rather than
duplicating the reference file's b80/b420 batch-scenario math: a batch size +
ramp (weeks) from this registry becomes another injected-demand input to the
same heatmap scenario engine C built, instead of a standalone calculator.

**Files:** `src/lib/clickhouse/fleet.ts` (new table), new Server Actions, a
searchable registry page, a small extension to C's scenario engine to accept a
backlog-batch parameter.

---

## Files affected (consolidated)

**New:**
- `src/app/dashboard/pedidos/[vo]/page.tsx` (+ intercepting route)
- `src/components/planning/PedidoDetail.tsx`
- `src/app/api/procurement/elaborate/route.ts` — new monthly cron (+ on-demand
  trigger) running the elaboration-trigger rule across every in-scope SKU
- New Server Actions per new table (scope, global-settings, hub-max-stock,
  frota logs, backlog registry)
- New small UI panels: SKU-scope manager, global floor/growth-rate settings,
  Frota data entry, Backlog registry
- One temporary migration route per new seeded table (SKU scope only needs
  this; everything else starts empty)

**Modified:**
- `src/lib/clickhouse/fleet.ts` (all new table DDL + `FLEET_TABLES` entries)
- `src/lib/planning/load.ts` (scope filter step)
- `src/lib/planning/purchase.ts` (combined-variance safety formula, `ropDoh`,
  new `findElaborationTrigger()` — DOH<75 scan + monthly-sea-batch/anytime-air
  modal decision)
- `src/lib/planning/weekgrid.ts` (scenario injection, floor param)
- `src/types/planning.ts` (`ropDoh`, `leadTimeStdDays`, `prep_status`-adjacent
  types)
- `src/components/planning/WeekGridView.tsx` (new controls)
- `src/app/dashboard/pedidos/actions.ts` (prep-status)
- `src/app/dashboard/skus/page.tsx`, `/dashboard/procurement` (rebuilt around
  the elaboration rule), `/dashboard/lead-times` (filters, toggles, scope
  manager)
- `vercel.json` (new monthly cron entry, alongside the existing daily/weekly
  ones)

## Verification plan

Per sub-project, once built:
1. `npx tsc --noEmit` + `npm run build` clean, existing test suite green.
2. Migration routes: build, trigger once, verify row count, delete (same
   pattern as the Supabase migration).
3. UI: load the affected page(s) in the deployed preview, confirm real data
   renders, confirm an edit round-trips (save → reload → see the change) and
   lands in `dev.fleet_audit_log`.
4. Cross-links: SKU → order and order → SKU navigation both resolve correctly.
5. Scope (A): confirm the default view narrows to the 139 SKUs and the full
   catalog page still shows everything.
6. Elaboration rule (B): unit-test `findElaborationTrigger()` against fixtures
   covering all three outcomes — sea in time, sea too late → air, even air too
   late (flagged late) — plus the monthly-batch date math (ordering on the 2nd
   vs. the 1st of the month) and the no-breach-in-horizon case. Confirm the
   monthly cron drafts exactly the expected `elaborado` rows against a small
   fixture set before trusting it against the full catalog.

## Out of scope (explicitly deferred)

- Wiring fleet growth into the ML demand forecast (E) — a model change, not a
  config-screen side effect.
- Clamping purchase-engine order quantities to max-stock/hub caps (B) —
  visibility/alert only in this pass.
- A full header/line-item schema split for purchase orders (D) — the flat,
  grouped-by-VO model already matches the reference file's shape and needs no
  migration.
- Anything from the original 20-item request not explicitly covered above.
