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

// ─── Open purchase orders (Supabase; fed by n8n / manual / xlsx import) ────────

export type PurchaseOrderStatus =
  | 'ordered'
  | 'in_transit'
  | 'customs'
  | 'received'
  | 'cancelled';

export type TransportModal = 'sea' | 'air';

export interface OpenPurchaseOrder {
  /** App-generated UUID (ClickHouse has no sequences). */
  id: string;
  vo: string | null;
  skuCode: string;
  skuBase: string;
  skuName: string | null;
  qty: number;
  orderDate: string;
  eta: string | null;
  leadTimeDays: number | null;
  modal: TransportModal | null;
  status: PurchaseOrderStatus;
  /** POs land at Osasco by default. */
  hubId: HubId;
  source: string;
}

// ─── Projection output ────────────────────────────────────────────────────────

export type ProjectionScope = 'global' | HubId;

export interface ProjectionPoint {
  date: string;
  /** Day offset from start (0 = today). */
  day: number;
  /** Projected end-of-day on-hand (clamped ≥ 0). */
  stock: number;
  /** Band from the forecast lo/hi (optimistic / pessimistic stock). */
  stockLo: number;
  stockHi: number;
  demand: number;
  inbound: number;
  recovery: number;
  transferIn: number;
  transferOut: number;
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
  /** Days of cover at the current rate, ignoring inbound/recovery. */
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

/** One SKU × week cell: end-of-week projected state. */
export interface WeekCell {
  stock: number;
  /** Days-of-hand at week end = stock / that day's daily demand; null when no demand. */
  doh: number | null;
  /** Units arriving (open POs) during the week. */
  inbound: number;
  /** Recovered units credited during the week. */
  recovery: number;
  isOut: boolean;
  isLow: boolean;
}

export interface WeekGridRow {
  skuBase: string;
  skuName: string;
  leadTimeSource: LeadTimeSource;
  status: PurchaseStatus;
  isLate: boolean;
  /** Week column the buy-by date falls in (null = no buy-by, or beyond the grid). */
  buyByWeekIdx: number | null;
  cells: WeekCell[];
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
