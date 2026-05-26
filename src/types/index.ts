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
  doh: number | null;
  dohStatus: DohStatus;
  lastUpdated: string;
}

export interface ConsumptionRecord {
  skuId: string;
  skuName: string;
  hubId: HubId;
  weekStart: string;
  qtyConsumed: number;
  soCount: number;
}

export interface HubSummary {
  hub: Hub;
  totalSkus: number;
  criticalCount: number;
  warningCount: number;
  okCount: number;
}
