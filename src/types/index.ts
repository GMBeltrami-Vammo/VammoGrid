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

export interface HubSummary {
  hub: Hub;
  totalSkus: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
}
