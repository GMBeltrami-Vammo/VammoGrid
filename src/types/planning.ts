// ─────────────────────────────────────────────────────────────────────────────
// VammoGrid 2.0 — Stock Planning & Logistics Platform
// Domain contracts. These are the STABLE interfaces the engines depend on; the
// data adapters (ClickHouse) and the upstream forecast model can change without
// touching the engines, as long as they keep producing these shapes.
//
// SKU identity: orders use `sku_code` (6 segments, VM-01-BAT0-0007-01-01); the
// forecast and stock layers key on `sku_base` (first 4 segments, VM-01-BAT0-0007).
// All planning math is at the sku_base grain. See lib/planning/sku.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** The three physical hubs. Osasco is the central distribution + recovery hub. */
export type HubId = 'osasco' | 'mooca' | 'sbc';

/** Observed recovery metrics derived from the IMS ledger (RECONDITION vs USAGE events). */
export interface HistoricalRecovery {
  /** recovered / consumed over the lookback window (0–1+). */
  rate: number;
  /** Total units with ledger_type = RECONDITION in the window. */
  recovered: number;
  /** Total units with ledger_type LIKE USAGE% in the window. */
  consumed: number;
  lookbackDays: number;
}

export interface Hub {
  id: HubId;
  name: string;
  /** IMS location_id in ClickHouse (analytics.stg_ims_r__location). */
  locationId: number;
  /** Osasco: all POs + recoveries land here, distributes to the spokes. */
  isCentral: boolean;
  /** For the transfer network map. Some IMS locations lack coords → configured here. */
  lat: number | null;
  lng: number | null;
}

/** ABC importance class (drives service level + target days-of-inventory). */
export type AbcClass = 'A' | 'B' | 'C';

// ─── Forecast contract (consumed from dev.sop_predictions_daily) ──────────────

/** One day of the demand forecast for a SKU. `day` is the 1-based horizon offset. */
export interface ForecastPoint {
  day: number;
  /** YYYY-MM-DD target date. */
  date: string;
  /** Point forecast of daily consumption (units/day). */
  yhat: number;
  /** Lower / upper band (prediction interval). */
  lo: number;
  hi: number;
}

export interface SkuForecast {
  skuBase: string;
  /** Date the forecast run was made (model "as of"). */
  asOfDate: string;
  abcClass: AbcClass;
  modelVersion: string;
  /** Number of days the model actually predicts (horizon); points beyond are extrapolated. */
  horizonDays: number;
  points: ForecastPoint[];
}

// ─── Stock state (derived per-hub from the IMS inventory + ledger) ────────────

/** Current on-hand for a SKU, split by hub plus the network total. */
export interface StockState {
  skuBase: string;
  skuName: string;
  byHub: Record<HubId, number>;
  total: number;
  /** Unit price (item_group_price) for cost estimates; null when not catalogued. */
  unitPrice: number | null;
  /** Whether the part can be reconditioned (feeds the recovery pipeline). */
  isRepairable: boolean;
  /** Coarse warehouse category: 'BIKE' | 'BATTERY' | 'BOX' | null. */
  category: string | null;
  /** When the underlying inventory was last updated. */
  lastUpdated: string;
}

// ─── Editable business policy (stored in Supabase) ────────────────────────────

export type LeadTimeSource = 'national-file' | 'international-default' | 'manual';

export interface SkuPolicy {
  skuBase: string;
  /** Display name for a manually-added SKU not yet in the warehouse snapshot. */
  skuName?: string | null;
  /** Effective lead time used by the engines = the default modal's value. */
  leadTimeDays: number;
  leadTimeSource: LeadTimeSource;
  /** Modal-split lead times (days). Effective leadTimeDays is derived from defaultModal. */
  leadTimeSeaDays: number | null;
  leadTimeAirDays: number | null;
  defaultModal: TransportModal;
  /** Std deviation of the lead time (days). Drives the lead-time-variability term of
   *  the combined-variance safety stock. null → treated as 0 (demand-only, original). */
  leadTimeStdDays: number | null;
  abcClass: AbcClass;
  /** Target days-of-inventory (order-up-to cover beyond lead time). */
  targetDoi: number;
  /** Fraction of consumption that returns as recovered stock (0–1+). */
  recoveryRate: number;
  /** Repair turnaround in days before recovered units are available at Osasco. */
  recoveryTurnaroundDays: number;
  /** When set, overrides the computed ABC-Z safety stock. */
  safetyOverride: number | null;
  isRepairable: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

// ─── Open purchase orders (ClickHouse dev.fleet_purchase_order) ────────────────

export type PurchaseOrderStatus =
  | 'ordered'
  | 'in_transit'
  | 'customs'
  | 'received'
  | 'cancelled';

/** Order-preparation lifecycle preceding the shipping status (sub-projects B6/D1).
 *  null = a normal/legacy order (sync/ingest/manual); a draft is 'elaborado'/'enviado';
 *  'feito' finalizes it into a real placed order. */
export type PrepStatus = 'elaborado' | 'enviado' | 'feito';

export type TransportModal = 'sea' | 'air';

export interface OpenPurchaseOrder {
  /** App-generated UUID (ClickHouse has no sequences). */
  id: string;
  vo: string | null;
  /** Human pedido name (pedido_name), when present — shown in the mini-heatmap arrow. */
  pedidoName?: string | null;
  skuCode: string;
  skuBase: string;
  skuName: string | null;
  qty: number;
  orderDate: string;
  eta: string | null;
  leadTimeDays: number | null;
  modal: TransportModal | null;
  status: PurchaseOrderStatus;
  /** null = placed order; a non-'feito' prep stage means a not-yet-placed draft
   *  (excluded from projected inbound until finalized). */
  prepStatus: PrepStatus | null;
  /** POs land at Osasco by default. */
  hubId: HubId;
  source: string;
  /** 'nacional' | 'internacional' | null — a national arrival is flagged in the heatmap. */
  orderType: string | null;
}

/** A draft order (elaborado/enviado) is not yet real inbound; only placed orders
 *  (no prep stage, or finalized 'feito') count toward projected stock. */
export function countsAsInbound(prepStatus: PrepStatus | null): boolean {
  return prepStatus == null || prepStatus === 'feito';
}

// ─── Projection output ────────────────────────────────────────────────────────

export type ProjectionScope = 'global' | HubId;

export interface ProjectionPoint {
  date: string;
  /** Day offset from start (0 = today). */
  day: number;
  /** Projected end-of-day on-hand (clamped ≥ 0). */
  stock: number;
  /** Runway DOH at this day: days the stock lasts against predicted consumption, ignoring
   *  incoming orders (integral). null = no consumption ahead (never runs out). See doh.ts. */
  doh: number | null;
  /** Band from the forecast lo/hi (optimistic / pessimistic stock). */
  stockLo: number;
  stockHi: number;
  demand: number;
  inbound: number;
  recovery: number;
  transferIn: number;
  transferOut: number;
  /** Cumulative demand NOT served up to this day (units) — the "lost sales" the
   *  floored stock walk drops. Monotonically non-decreasing; arrivals go to stock,
   *  never to paying this off. Charted as the red backlog line. */
  backlog: number;
  /** True once `day` exceeds the model horizon (demand is extrapolated). */
  extrapolated: boolean;
}

export interface StockProjection {
  skuBase: string;
  skuName: string;
  scope: ProjectionScope;
  currentStock: number;
  /** Total forecast daily demand at this scope at the start (units/day). */
  dailyDemand: number;
  /** Days of cover = stock ÷ the next 7 days' average demand (canonical DOH rate),
   *  ignoring inbound/recovery. */
  dohNow: number | null;
  /** First date stock hits 0 considering inbound + recovery; null if none in horizon. */
  stockoutDate: string | null;
  daysUntilStockout: number | null;
  incomingUnits: number;
  timeline: ProjectionPoint[];
}

// ─── Weekly stockout grid (projection sampled at week marks) ──────────────────

/** One column of the weekly grid. */
export interface WeekMeta {
  /** 1-based week number. */
  idx: number;
  /** Day offset from today at this week's end (7, 14, … 56). */
  dayOffset: number;
  /** YYYY-MM-DD date at week end. */
  endDate: string;
}

/** Arriving units for ONE transport modal in a week: registered (already-placed) vs
 *  suggested (scenario "buy when needed"). The heatmap is now N-modal — a supplier can
 *  offer Courier/Aéreo/Marítimo… — so arrivals are a list, not a fixed sea/air pair. */
export interface WeekArrival {
  /** Display modal name (e.g. 'Marítimo', 'Aéreo', 'Courier'). Legacy 'sea'/'air' POs are
   *  normalized to 'Marítimo'/'Aéreo'. */
  modal: string;
  reg: number;
  sug: number;
}

/** One SKU × week cell: end-of-week projected state. */
export interface WeekCell {
  stock: number;
  /** Days-of-hand at week end = stock / the NEXT 7 days' average daily demand; null when
   *  no upcoming demand. */
  doh: number | null;
  /** Units arriving (open POs) during the week. */
  inbound: number;
  /** Per-modal arrivals this week (registered + suggested) — the inline markers + tooltip.
   *  Only modais with a nonzero arrival are listed. */
  arrivals: WeekArrival[];
  /** Linkable keys (VO, else row id) of the REGISTERED orders arriving this week — the
   *  cell links to the pedido page. Empty = no real placed order arriving (or spoke hub). */
  arrVos: string[];
  /** Recovered units credited during the week. */
  recovery: number;
  /** Registered NATIONAL (nacional) arrivals this week — flagged with its own marker
   *  (national emergency purchases, distinct from the international default). */
  arrNat: number;
  isOut: boolean;
  isLow: boolean;
  /** True once this week is past the model's real forecast horizon (extrapolated). */
  extrapolated: boolean;
}

export interface WeekGridRow {
  skuBase: string;
  skuName: string;
  leadTimeSource: LeadTimeSource;
  /** Default transport modal — drives the marítimo/aéreo heat filter. */
  defaultModal: TransportModal;
  /** Average daily consumption (units/day) for the scope — shown in the left column. */
  dailyDemand: number;
  status: PurchaseStatus;
  isLate: boolean;
  /** Week column the buy-by date falls in (null = no buy-by, or beyond the grid). */
  buyByWeekIdx: number | null;
  /** Recovery (refurb) inflow params — shown beside consumption (%/turnaround). */
  recoveryRate: number;
  recoveryTurnaroundDays: number;
  /** Coarse warehouse category ('BIKE'|'BATTERY'|'BOX'|null) — a local heatmap filter. */
  category: string | null;
  /** ABC class — a local heatmap filter. */
  abcClass: string;
  /** Registered open POs feeding this SKU (countsAsInbound) — listed in the left column. */
  openPos: { id: string; vo: string | null; eta: string | null; qty: number; modal: string | null }[];
  cells: WeekCell[];
}

/** Coverage scenario for the heatmap. Now N-modal (mega-rodada): a scenario key is
 *  'baseline', 'combined', or a supplier modal name (e.g. 'Courier'/'Aéreo'/'Marítimo').
 *  The scenario SET is computed from the SKUs' suppliers, so it's a string. */
export type WeekGridScenario = string;

/** Describes one heatmap scenario for the UI (dynamic set). */
export interface ScenarioMeta {
  /** 'baseline' | 'combined' | a modal name. */
  key: string;
  label: string;
  kind: 'baseline' | 'modal' | 'combined';
}

// ─── Purchase recommendation ──────────────────────────────────────────────────

export type PurchaseStatus = 'CRITICAL' | 'REORDER' | 'OK';
export type RiskLevel = 'high' | 'medium' | 'low';

export interface PurchaseSuggestion {
  skuBase: string;
  skuName: string;
  abcClass: AbcClass;
  status: PurchaseStatus;
  riskLevel: RiskLevel;
  onHand: number;
  leadTimeDays: number;
  /** Estoque mínimo: expected consumption integrated over the lead time (Σ yhat over L). */
  expectedLeadTimeDemand: number;
  /** σ of the next 30 days of consumption, from the forecast band (RSS of daily σ). */
  sigmaMonthly: number;
  /** σ over the lead time = σ_mês × √(lead em meses). Drives the safety stock. */
  sigmaL: number;
  /** Effective safety stock (manual override, or ABC_Z[class] × σ_L). */
  safetyStock: number;
  /** Reorder point = estoque mínimo (expectedLeadTimeDemand) + safetyStock. */
  rop: number;
  /** ROP expressed in days of cover = rop / daily demand (null when no demand). B4. */
  ropDoh: number | null;
  orderUpTo: number;
  /** Suggested quantity to order now (0 when stock > ROP). */
  orderQty: number;
  stockoutDate: string | null;
  /** Last day to place the order to avoid rupture = stockoutDate − leadTime. */
  buyByDate: string | null;
  /** True when buyBy is already in the past (expedite / switch sea→air). */
  isLate: boolean;
  suggestedOrderDate: string | null;
  expectedArrival: string | null;
  /** Open-PO units expected within the horizon (already netted from orderQty). */
  incomingUnits: number;
  estCost: number | null;
  reasoning: string;
}

// ─── Elaboration trigger (Compras' reorder rule — sub-project B5) ─────────────
// Distinct from the statistical ROP above: a forward-looking DOH<threshold scan
// over the projected stock, with a monthly-batched-sea vs. anytime-air modal
// decision. This is what Compras uses to decide when to draft a pedido.

export interface ElaborationSuggestion {
  skuBase: string;
  skuName: string;
  /** True when projected DOH drops below the threshold somewhere in the horizon. */
  needsOrder: boolean;
  /** DOH today (day 0), for context. */
  dohNow: number | null;
  /** Daily demand at day 0 (units/day), for context. */
  dailyDemand: number;
  /** First date projected DOH falls below the threshold; null when it never does. */
  firstBreachDate: string | null;
  /** The projected DOH at that first-breach day. */
  breachDoh: number | null;
  /** Recommended modal for the drafted order (null when no order needed). */
  suggestedModal: TransportModal | null;
  /** Date the recommended order would be placed (sea = next monthly batch; air = today). */
  suggestedOrderDate: string | null;
  /** Projected arrival of the recommended order. */
  expectedArrival: string | null;
  /** True when even air can't arrive before the breach (order anyway, but flagged). */
  isLate: boolean;
  /** Modal lead times used, for display. */
  leadTimeSeaDays: number;
  leadTimeAirDays: number;
}

// ─── Transfer recommendation (weekly hub-and-spoke) ───────────────────────────

export interface TransferSuggestion {
  skuBase: string;
  skuName: string;
  qty: number;
  fromHub: HubId;
  toHub: HubId;
  /** Date the destination hub is projected to need the stock by. */
  needByDate: string | null;
  /** 0–1 trust score = precision × freshness (clamped 0.05–0.95). */
  confidence: number;
  /** 0–1 forecast precision over the window: 1/(1+cv) of cumulative demand. */
  precision: number;
  /** 0–1 forecast freshness: decays linearly to 0.3 by 30 days stale. */
  freshness: number;
  /** Transfer cycle: 1 = this week (Tuesday), 2 = next week. */
  cycle: number;
  reason: string;
}

// ─── Alerts (consumed from dev.sop_alerts, re-projected per hub) ──────────────

export type AlertCode =
  | 'STK_RUPTURE'
  | 'STK_BELOW_ROP'
  | 'STK_BELOW_SS'
  | 'DEM_TREND_UP'
  | 'DEM_VARIABILITY'
  | 'STK_OBSOLETE';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface PlanningAlert {
  code: AlertCode;
  severity: AlertSeverity;
  skuBase: string;
  skuName: string;
  hub: HubId | 'ALL';
  reason: string;
  /** Parsed metrics blob: cover, LT, OH, demand_LT, etc. */
  metrics: Record<string, number>;
  unitPrice: number | null;
}
