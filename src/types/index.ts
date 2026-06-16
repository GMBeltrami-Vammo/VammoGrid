export type HubId = 'mooca' | 'osasco' | 'sbc';

export type DohStatus = 'critical' | 'warning' | 'ok' | 'unknown';

export interface Hub {
  id: HubId;
  name: string;
  shortName: string;
  isRecoveryCenter: boolean;
}

export interface InventoryItem {
  skuId: string;
  skuName: string;
  category: string;
  hubId: HubId;
  qtyAvailable: number;
  /** Average daily consumption at THIS hub over the last 30 days (from Maestro OS) */
  dailyConsumption: number;
  doh: number | null;
  dohStatus: DohStatus;
  lastUpdated: string;
}

export interface ConsumptionRecord {
  /** Maestro item_group_name — used as the item identifier */
  itemGroup: string;
  hubId: HubId;
  /** ISO date string (day granularity) */
  day: string;
  qtyConsumed: number;
  /** Sorted list of Maestro OS IDs that consumed this item on this day */
  os: number[];
  /** Average daily consumption over the last 30 days for this item+hub */
  monthlyAvg: number;
}

export interface InventorySnapshot {
  snapshotDate: string; // YYYY-MM-DD
  skuName: string;
  hubId: HubId;
  qtyAvailable: number;
  doh: number | null;
  dohStatus: DohStatus;
}

export interface MonthlyClosing {
  /** First day of the closing month, e.g. "2026-06-01" */
  closingMonth: string;
  /** Actual date the closing was captured */
  snapshotDate: string;
  skuId: string;
  skuName: string;
  hubId: HubId;
  qtyAvailable: number;
  /** Average daily consumption over the 30 days before the closing (un/dia) */
  avgDailyConsumption: number;
  doh: number | null;
}

export type AlertType =
  | 'doh_critical'
  | 'hub_zero'
  | 'total_zero'
  | 'consumption_spike';

export interface Alert {
  type: AlertType;
  skuId: string;
  skuName: string;
  /** Hubs relevant to this alert (e.g. which hubs are zeroed, or which is critical) */
  hubs: HubId[];
  /** Lowest DOH across the flagged hubs (for doh_critical) */
  doh?: number | null;
  /** consumption_spike: day label, e.g. "Sexta-feira - 30/05" */
  dayLabel?: string;
  /** consumption_spike: ISO day (YYYY-MM-DD) — for sorting */
  daySort?: string;
  /** consumption_spike: units consumed on that day */
  dayQty?: number;
  /** consumption_spike: current stock for the item+hub */
  currentStock?: number;
  /** consumption_spike: monthly average consumption (un/month) */
  monthlyConsumption?: number;
  /** consumption_spike: daily average (L30D) — for the multiplier */
  avg?: number;
}

export interface HubSummary {
  hub: Hub;
  totalSkus: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
}

// ─── Planning layer: purchase orders, compatibility, fleet, recovery ──────────

export type PurchaseOrderStatus =
  | 'ordered'
  | 'in_transit'
  | 'customs'
  | 'received'
  | 'cancelled';

export interface PurchaseOrder {
  id: number;
  /** VO reference label, e.g. "266" */
  vo: string | null;
  /** SKU code — joins to InventoryItem.skuId */
  sku: string;
  skuName: string | null;
  qtyOrdered: number;
  /** YYYY-MM-DD */
  orderDate: string;
  /** YYYY-MM-DD — expected arrival at hub (may be null if only lead time is known) */
  eta: string | null;
  leadTimeDays: number | null;
  status: PurchaseOrderStatus;
  /** 'air' | 'sea' */
  modal: string | null;
  hubId: HubId;
  notes: string | null;
  /** 'n8n' | 'manual' */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export const BIKE_MODELS = [
  'cpx_preta',
  'cpx_prata',
  'cpx_cinza',
  'cpx_azul',
  'cpx_pro_azul',
  'vs1_branco',
  'vs2_preta',
  'comfort_azul',
  'comfort_v2_azul',
] as const;

export type BikeModel = (typeof BIKE_MODELS)[number];

export interface PartCompat {
  /** SKU code */
  sku: string;
  description: string | null;
  partNumber: string | null;
  aplicacao: string | null;
  nacionalizado: boolean;
  models: Record<BikeModel, boolean>;
  updatedAt: string;
  updatedBy: string | null;
}

export interface FleetInfo {
  /** 'total' (whole fleet) or a model name */
  segment: string;
  currentSize: number;
  /** fraction per month, e.g. 0.05 = 5%/month */
  monthlyGrowthRate: number;
  asOfDate: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SkuParams {
  /** SKU code */
  sku: string;
  /** fraction of consumption that returns as recovered parts (0–1+) */
  recoveryRate: number;
  /** N: window/delay in days for the recovery formula */
  recoveryLookbackDays: number;
  leadTimeDays: number | null;
  abcClass: string | null;
  targetDoi: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

// Stock projection (the "future expectation") ---------------------------------

export interface ProjectionPoint {
  /** YYYY-MM-DD */
  date: string;
  /** projected on-hand stock at end of this day (clamped at 0) */
  stock: number;
  /** PO units arriving this day */
  inbound: number;
  /** recovered units added this day */
  recovery: number;
  /** units consumed this day */
  consumption: number;
}

export interface StockProjection {
  sku: string;
  skuName: string;
  currentStock: number;
  /** total daily consumption across hubs (un/day) */
  dailyConsumption: number;
  /** DOH ignoring incoming orders (current = stock / consumption) */
  dohNow: number | null;
  /** first date stock reaches 0 considering inbound + recovery; null if none in horizon */
  stockoutDate: string | null;
  daysUntilStockout: number | null;
  /** total PO units arriving within the horizon */
  incomingUnits: number;
  timeline: ProjectionPoint[];
}
