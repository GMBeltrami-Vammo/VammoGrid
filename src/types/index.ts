export type HubId = 'mooca' | 'osasco' | 'sbc';

export interface Hub {
  id: HubId;
  name: string;
  shortName: string;
  isRecoveryCenter: boolean;
}

// ─── Planning layer: purchase orders, compatibility, fleet ────────────────────

export type PurchaseOrderStatus =
  | 'ordered'
  | 'in_transit'
  | 'customs'
  | 'received'
  | 'cancelled';

/** Order-preparation lifecycle preceding the shipping status (B6/D1). */
export type PrepStatus = 'elaborado' | 'enviado' | 'feito';

export interface PurchaseOrder {
  /** App-generated UUID (ClickHouse has no sequences). */
  id: string;
  /** VO reference label, e.g. "266" */
  vo: string | null;
  /** SKU code */
  sku: string;
  skuName: string | null;
  qtyOrdered: number;
  /** YYYY-MM-DD */
  orderDate: string;
  /** YYYY-MM-DD — expected arrival at hub (may be null if only lead time is known) */
  eta: string | null;
  leadTimeDays: number | null;
  status: PurchaseOrderStatus;
  /** Preparation stage (elaborado/enviado/feito) preceding the shipping status; null
   *  for normal/legacy orders. */
  prepStatus: PrepStatus | null;
  /** 'air' | 'sea' */
  modal: string | null;
  hubId: HubId;
  notes: string | null;
  /** 'n8n' | 'manual' | 'clickhouse' */
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
