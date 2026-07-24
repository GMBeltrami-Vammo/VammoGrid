# Overnight build — 2026-07-23 → executed 2026-07-24 02:00 BRT

Autonomous overnight build of 4 features + an adversarial review pass.
This run executed inside a kept-alive interactive session (at Gabriel's request), on Opus 4.8 (1M), fired by an in-session 2 AM timer — not the fresh scheduled task.
Every feature: `npx vitest run` + `npx tsc --noEmit` + `npm run build` all green before each commit; the weekgrid characterization snapshot stayed byte-identical throughout; commits staged specific paths only (never `git add -A`), no Co-Authored-By line.

## 1. What shipped, commit by commit

| Commit | Feature | Summary |
|---|---|---|
| `902299a` | **A — Forecast coalesce** | New PRIMARY source `ml_models_dev.spare_parts_consumption_forecast_daily` (the corrected consumption model) coalesced per-SKU with `dev.sop_predictions_daily` (superset fallback). Pure merge in `forecastMerge.ts` (13 tests); `SkuForecast` gains a `source` provenance field shown via a new `ForecastSourceBadge` on the SKU page header + SKU list. Engine untouched (`SkuForecast` is the contract boundary). |
| `6eabda2` | **B — Editable fleet control points** | Fleet size is now a control-point model (reusing `dev.fleet_size_weekly`): past = linear interpolation between consecutive `(date, size)` points, constant before the first, future = linear growth off the last. New pure `fleetSizeOn`/`buildFleetDailySeries` (the daily divisor Feature C consumes). Chart + `FleetWeeklyPanel` rewired. |
| `98efc78` | **C — L30/L90 naive comparison engines** | Comparison-only naive baselines drawn as faded reference lines: `rate = mean of daily consumption(d)/fleet(d)` over 30/90 days (zero days count, fleet≤0 skipped), fleet compat-aware. A synthetic forecast re-projected via `projectSku` with the same orders/policy so the lines are point-to-point comparable in units and DOH. Never feeds ordering/weekgrid. |
| `cdbac7d` | **D — App-wide SKU popup** | A shared `<SkuLink>` intercepts left-click to open a Dialog with a compact SKU summary (provenance badge, KPIs, D-7→D+30 chart with L30/L90 faded + DOH toggle, an 8-week DOH mini-heatmap, "Ver página completa" link). Slim payload via `GET /api/fleet/sku-summary`; 14 link sites + the top-bar search converted. |
| `98ba27a` | **Review fixes** | 7 confirmed adversarial-review findings fixed, including a live production bug (see §4). |

138 → 184 unit tests over the run; final `tsc` + `build` clean.

## 2. Autonomous decisions made (and why)

### Feature A
- `SkuForecast.source` was made OPTIONAL, not required, so the synthetic forecasts built by Features C/D don't have to fake a provenance.
- The coalesce merge lives in a new PURE module `forecastMerge.ts` (no `server-only`) so it is unit-testable directly; the I/O (SQL + cache) stays in `forecast.ts`.
- A defensive `try/catch` was added around the primary read so a genuinely-absent table degrades to S&OP rather than breaking the app — the review later NARROWED this to only swallow "table missing" errors (see §4).
- The bundle-level `asOfDate` reports the freshest run across both sources; the exact per-SKU source + date ride on each `SkuForecast` for the badge.

### Feature B
- Reused `dev.fleet_size_weekly` as the control-point store — no new table/column, per the spec's strong preference.
- The chart samples the control-point curve on the weekly grid ∪ the real point dates, so real records show as exact vertices with interpolation/growth between them.
- A segment with no weekly records falls back to a single synthetic point at its `fleet_info` as-of/current size (so it still charts).
- `projectFleetGrowth` was kept (still tested) and refactored to share one `linearSize` formula with the new control-point growth — one canonical definition.
- `FleetWeeklyPanel` now lists ALL control points (was the last 8) so older points stay editable; re-entering a date updates that point.

### Feature C
- The naive-rate window ends YESTERDAY (today's consumption is partial), and zero-consumption days count as rate 0 (per the locked spec — mean over ALL days in the window).
- New file `naiveEngines.ts` (not `engines.ts`) to avoid confusion with the existing misleadingly-named `engines.test.ts` (which tests purchase/projection).
- Comparison line colours: L30 violet `#7c3aed`, L90 teal `#0d9488`, both faded (opacity 0.4, dashed, thin, no dots) — clearly subordinate to the brand line.
- An engine with no consumption signal (rate ≤ 0) draws no line.
- Comparison lines bypass the `isGlobalOrOsasco` overlay guard, because a naive-demand swap is valid at every scope (it isn't a receipts/recovery overlay).

### Feature D
- Built a SELF-CONTAINED portal Dialog (`components/ui/dialog.tsx`) rather than `@base-ui/react/dialog`, to avoid guessing the v1.5 API — the repo had no shadcn dialog.
- The two `<select>` SKU switchers ON the Estoque page and the legacy redirects (`sku/[sku]`, `projection`) were LEFT as navigation — they change the page you're already on, so a popup would be wrong; deep links keep working.
- Extracted `mapFleetSegments` + `buildNaiveComparisons` as shared pure helpers so the Estoque page and the popup route use ONE definition of the naive comparison (the Estoque page was refactored onto them).
- The mini-heatmap arrival marker uses a lucide `ChevronDown` icon, not a `▼` glyph (mojibake avoidance, per decisions #27).
- `SkuPopupProvider` wraps the `FilterBar` too, so the top-bar SKU search opens the popup.

### Review round
- Ran a Workflow of 6 finder dimensions → one Fable verifier per finding (refute-biased). Fixed the 7 confirmed; recorded the non-confirmed and why (see decisions.MD #37).

## 3. Perguntas pendentes (postponed — need a human call)

1. **Feature C surface #3 — Prev×Real faded L30/L90 lines (DEFERRED).**
   Exact question: "Do you want the L30/L90 comparison lines on the Previsão×Realizado demand chart, computed as-of each pedido's frozen window?"
   Why postponed: it needs historical fleet reconstruction + pre-emission consumption, and the spec itself hedged this surface ("show only where honest and note it"); the two PRIMARY surfaces (Estoque charts + the SKU popup) shipped. The tools to build it now exist (`buildFleetDailySeries` gives historical fleet; `fetchDailyConsumption` gives pre-emission consumption) — it's a scoped follow-up.

2. **Surface a "running on S&OP-only" signal (review follow-up, non-blocking).**
   Exact question: "Want a visible indicator (Fontes page / freshness banner) when the primary consumption model is absent so a total fallback is never invisible again, plus a provisioning check that runs `PRIMARY_SELECT LIMIT 1` against the real schema?"
   Why postponed: the immediate live bug is fixed and the catch now re-throws non-missing errors, so a real failure surfaces; the health-panel surfacing is additive UI.

3. **ClickHouse query parameters instead of manual escaping (review follow-up).**
   Exact question: "Migrate reads to CH HTTP query parameters (`param_x=` + `{x:String}`) to remove the escaping burden entirely?"
   Why postponed: a larger change to `reader.ts`; the hardened `esc()` + the subquery fix resolve the immediate issue.

## 4. The live bug the review caught (worth reading)

Feature A's `PRIMARY_SELECT` aliased `toString(as_of_date) AS as_of_date` in the SAME select as `WHERE as_of_date = (SELECT max(as_of_date)…)`.
ClickHouse resolves a WHERE identifier to a same-name SELECT alias by default, so the filter compared the String alias to a Date subquery and threw `Code 386 NO_COMMON_TYPE` on EVERY request.
The primary read therefore failed every time, was caught, and the app ran silently on the inferior S&OP model for every SKU — the exact opposite of what Feature A was for.
A Fable verifier ran the real SQL against the warehouse (ClickHouse 26.2.1, via Metabase) and reproduced it live, then confirmed the fix (filter in an alias-free inner subquery → 29,120 rows for the latest run).
This is fixed in `98ba27a`; the catch is now narrowed to only swallow genuine "table missing" errors.

## 5. Follow-ups Gabriel must run

- **IMPORTANT — bust the forecast cache after deploy:** run `GET /api/admin/refresh-cache?tag=forecast` so the now-fixed primary consumption model actually loads (the alias bug meant it never did, and the 6h cache may hold stale S&OP-only data).
- **No schema changes / no `provision-fleet` needed** — all four features reused existing tables/columns; the new API route needs no DDL. (Confirm, but nothing is pending.)
- **E2E visual check** — I could not exercise the live app (no ClickHouse creds in-session; validated via unit tests + `tsc` + `build`, per the run's no-live-data rule). Please click through the SKU popup, the provenance badge, the Frota control-point chart, and the L30/L90 faded lines against real data.
- **The fresh 2 AM scheduled task** (`vammogrid-popup-l30l90-fleet-coalesce`) was DISABLED so it wouldn't double-run this session's build; the build is done, so delete it (it's a one-time task, now superseded).
