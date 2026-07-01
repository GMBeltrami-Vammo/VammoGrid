# VammoGrid — Decision Log

Traceability record of architectural and product decisions made during the build.
Each entry records what was decided, why, and when.

---

## Architecture Decisions

| # | Decision | Chosen | Alternatives Considered | Rationale |
|---|---|---|---|---|
| 1 | Framework | Next.js 15 (App Router) | Vite + React SPA, Remix | Vercel-native zero-config deploy; API routes provide server-side Metabase proxy so credentials never reach the browser; TypeScript first |
| 2 | UI library | shadcn/ui + Tailwind CSS v4 | MUI, Ant Design, Chakra | Unstyled headless primitives owned by the codebase (no vendor lock); Tailwind v4 already bundled with create-next-app; fast to compose for internal tools |
| 3 | Charts | Recharts | Chart.js, Nivo, Victory | React-native, TypeScript-typed, excellent line/area/bar support for DOH and consumption charts; lighter than Nivo |
| 4 | Client data fetching | TanStack Query v5 | SWR, Redux Toolkit Query, fetch | Declarative server-state caching; staleTime can be aligned with the API cache TTL; built-in loading/error/refetch states |
| 5 | Tables | TanStack Table v8 | AG Grid (overkill), react-table v7 | Sortable + filterable with typed column definitions; headless — uses shadcn/ui Table for rendering; same ecosystem as TanStack Query |
| 6 | Authentication | None (public, unlisted URL) | NextAuth.js + credentials, Supabase Auth | Internal MVP; keeping the URL unlisted is sufficient for now; NextAuth can be added later without refactor (session provider already available in Next.js) |
| 7 | Primary data source (V1) | Metabase API proxy | ClickHouse direct, CSV export | Reuses existing Metabase question #27759; API key auth (`X-Api-Key` header) — simpler and more stable than session tokens (no expiry, no re-auth logic needed) |
| 8 | Primary data source (V2) | ClickHouse direct | Metabase only | ClickHouse is the actual warehouse behind all Metabase numbers; direct queries unlock SO history for forecasting and are more performant |
| 9 | Deployment region | Vercel GRU (São Paulo) | US-East, Auto | Low latency to metabase.vammo.com which is Brazil-hosted; reduces p99 on every data fetch |
| 10 | Primary data source (V3) | ClickHouse direct ONLY — Metabase fully removed | Keep both (fallback), Metabase only | Metabase's REST fallback cost ~2-3x the round-trips per page load (a 2000-row native-query cap forced the forecast alone into a DISTINCT + ~15 batched queries); confirmed CLICKHOUSE_* reachable from Vercel gru1, so the fallback had no remaining purpose. Deleted `lib/metabase/*`, the two `/api/metabase/*` routes, the dormant V1 client-architecture (`useInventory`/`useConsumption`/`useAlerts`/`useProjections`/`FilterContext`/`lib/projection.ts`/`components/inventory/*` island — zero live importers), and the admin "Recuperação" tab (wrote to `fleet.sku_params`, which the engine never read — superseded by `fleet.sku_policy`). Dropped `fleet.piece_stock_hub[_monthly]` (Metabase-sourced snapshot cron, unread by the app) and `fleet.sku_params`. |
| 11 | Config/state storage | ClickHouse ONLY — Supabase fully removed | Keep Supabase for editable config, split ClickHouse (facts) / Supabase (config) | Discovered the Supabase project was never VammoGrid-specific — a shared multi-tenant Postgres instance also running goBuy/Lumen (`finance`), a CX/Horus RAG assistant (`cx`/`public`), Kustomer sync, LLM-cost governance, and IoT alerting; VammoGrid's actual footprint (`fleet` schema) was 5 live tables / ~843 rows / 0 functions / 0 FKs — tiny and structurally flat (already a pure ETL-landing shape, not relational). User will manage the Supabase side directly; this decision covers removing the app's *dependency* only. Migrated `sku_policy`, `purchase_order`, `part_compat`, `fleet_info`, `job_run` → `dev.fleet_*` in ClickHouse (verified: exact row-count match post-copy). Two tables (`fleet.test_part_bike`, `fleet.test_part_service_order`, 1,287 rows) were found to have **zero references anywhere in VammoGrid's code** — not migrated, flagged to the user as possibly belonging to a different project against the same schema. `fleet.piece_stock_hub`/`_monthly`, `fleet.sku_params`, and the migration-file-only tables (`hub`, `transfer_constraint`, `forecast_override`, `plan_run`, `plan_line`) were confirmed already gone from the live schema (consistent with decision #10) — nothing to migrate. Mutation model: ClickHouse has no OLTP-speed row UPDATE/DELETE, so `dev.fleet_*` tables are `ReplacingMergeTree(updated_at)` + a soft-delete flag (read via `FINAL`; a write = a fresh full-row insert) — table sizes are tiny (≤ 1,000 rows) so `FINAL`'s cost is a non-issue. Every write also appends a per-field diff to a new shared `dev.fleet_audit_log` (append-only `MergeTree`) — "editable and logged" as one reusable mechanism rather than one per table. `purchase_order.id` moved from a Postgres bigint sequence to an app-generated UUID string (ClickHouse has no sequences). Along the way, found and fixed a real pre-existing bug: `middleware.ts`'s route-exclusion matcher was missing `/api/orders/sync`, so the daily cron's own `CRON_SECRET` check was unreachable — an unauthenticated request (exactly what a cron sends) was 401'd by middleware before the route ever ran. |
| 12 | Order-orchestration platform | Built per `docs/superpowers/specs/2026-07-01-order-orchestration-platform-design.md` (7 sub-projects, A→B→D→C→E→F→G) | Bigger-bang rewrite; deferring pieces | Spec approved after two review rounds. Implemented all 7: **(A)** default SKU universe = 139 reference SKUs in `dev.fleet_sku_scope`, narrowed app-wide in `loadPlanningInputs`/`loadSkuView` (fail-open when empty; `ignoreSkuSelection` bypasses for the "Lista completa" tab + deep links); editable on the SKUs page. **(B)** global service-level tier (Base/Padrão/Conservador = 95/97/99% → z, in `dev.fleet_global_settings`) overriding per-ABC z; lead-time σ → combined-variance safety `√(σ_d²·L + demand̄²·σ_LT²)`; per-hub max-stock caps (alert-only, no engine clamp); ROP-in-DOH on SKU detail; **the elaboration rule** (`findElaborationTrigger`: first day DOH<75 → maritime if the monthly-batch sea order arrives in time, else air, else air-flagged-late) — now Compras' entire reorder logic, computed on load, **written only on explicit human confirm** (`createElaboratedOrder` → a `prep_status='elaborado'` draft; no cron writes); national/international toggle. The old statistical ROP stays on the SKU detail only. **(D)** `prep_status` lifecycle (elaborado→enviado→feito; drafts excluded from projected inbound via `countsAsInbound`); pedido detail page `/pedidos/[vo]` (grouped lines + summary + audit-log history + prep transitions); SKU↔pedido cross-links. **(C)** Semanas heatmap: coverage scenario (baseline/air/sea/complete — synthetic order injection), service-level-tier DOH coloring floor, heat-filter + horizon (8/12/16/20) + DOH↔units toggle, extrapolated-week greying. **(E)** steady fleet-growth projection + Visão Geral panel (reads `dev.fleet_info`; NOT wired into the ML forecast). **(F)** frota manual ledgers (`dev.fleet_bike_{sales,order}_log`). **(G)** motos-paradas registry (`dev.fleet_backlog_bike_log`) + a heatmap "Backlog" demand-uplift toggle (extra% ≈ parado/fleet, reusing the forecast scaler — no BOM). All new state is ClickHouse `dev.fleet_*` (no Supabase, per #11), every edit audit-logged via `upsertFleetRow`/`softDeleteFleetRow`; new columns added via idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` (run by `provisionFleetTables`, invoked by the seed route). `dev.fleet_sku_scope` seeded via a one-off GET/POST route (isHead-gated) to be deleted after running. |

---

## Product Decisions

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| P1 | V1 scope | Inventory table + DOH + Consumption charts | Foundation visibility layer first; forecasting and transfer suggestions require consumption time-series data not yet available |
| P2 | Consumption data source | Stub in V1, new Metabase question in V1.1 | Metabase question #27759 returns only a current snapshot (qty + DOH); a second question querying weekly SO consumption per SKU per hub is needed |
| P3 | Transfer suggestions | V2 | Requires reliable consumption time-series; adding before that creates noise rather than signal |
| P4 | Demand forecasting | V2 | Built on top of consumption time-series; Simple Moving Average (4-week window) planned |
| P5 | DOH thresholds | Warning ≥ 14 days, Critical ≤ 7 days | Baseline from similar operations; configurable via env vars (`DOH_WARNING_THRESHOLD`, `DOH_CRITICAL_THRESHOLD`) |
| P6 | Osasco recovery inflow | V2 | No current data source defined; requires a Maestro IMS query or separate Metabase question |
| P7 | Hub set | Mooca, Osasco, SBC | The 3 active maintenance hubs as of 2026; Osasco flagged as sole recovery center |

---

## Open Questions / Future Decisions

| # | Question | Status |
|---|---|---|
| Q1 | Exact column names returned by Metabase question #27759 | Obsolete — Metabase removed entirely (decision #10); superseded by direct ClickHouse reads |
| Q2 | Metabase question ID for weekly SO consumption per SKU/hub | Obsolete — superseded by `dev.sop_predictions_daily` (the S&OP forecast) read directly from ClickHouse |
| Q3 | When to add authentication | When the app URL needs to be shared more broadly or accessed from outside Vammo's network |
| Q4 | Osasco inflow data source | Maestro IMS API or new Metabase question — to be scoped in V2 |
| Q5 | DOH minimum thresholds per SKU | Currently global (14d / 7d); per-SKU thresholds may be needed as operations mature |
