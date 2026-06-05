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

export type AlertType = 'doh_critical' | 'hub_zero' | 'total_zero';

export interface Alert {
  type: AlertType;
  skuId: string;
  skuName: string;
  /** Hubs relevant to this alert (e.g. which hubs are zeroed, or which is critical) */
  hubs: HubId[];
  /** Lowest DOH across the flagged hubs (for doh_critical) */
  doh?: number | null;
}

export interface HubSummary {
  hub: Hub;
  totalSkus: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
}
