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
| Q1 | Exact column names returned by Metabase question #27759 | To verify on first API call — hub name normalization depends on this |
| Q2 | Metabase question ID for weekly SO consumption per SKU/hub | To be created — coordinate with Data team |
| Q3 | When to add authentication | When the app URL needs to be shared more broadly or accessed from outside Vammo's network |
| Q4 | Osasco inflow data source | Maestro IMS API or new Metabase question — to be scoped in V2 |
| Q5 | DOH minimum thresholds per SKU | Currently global (14d / 7d); per-SKU thresholds may be needed as operations mature |
