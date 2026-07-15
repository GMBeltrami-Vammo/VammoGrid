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

/** Pedido classification (review 7a/3b): national vs international purchase. */
export type OrderType = 'nacional' | 'internacional';

export interface PurchaseOrder {
  /** App-generated UUID (ClickHouse has no sequences). */
  id: string;
  /** VO reference label, e.g. "266" */
  vo: string | null;
  /** Human-friendly pedido name (review 7a); null for synced/legacy orders. */
  pedidoName: string | null;
  /** nacional | internacional; null when untyped (synced/legacy). */
  orderType: OrderType | null;
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
  /** 'clickhouse' (synced) | 'manual' | 'elaboracao' | 'import' */
  source: string;
  /** JSON frozen at "Criar pedido" (review item 8): forecast asOf, criteria/rules in
   *  effect, suggested vs chosen qty — the basis for previsão×realizado later. */
  elaborationSnapshot: string | null;
  /** Fornecedor vinculado ao pedido (review 4b); null quando não atribuído. */
  supplierId: string | null;
  supplierName: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Fornecedores (review 4b) ─────────────────────────────────────────────────

export type SupplierKind = 'nacional' | 'internacional';

export interface Supplier {
  supplierId: string;
  name: string;
  kind: SupplierKind;
  contact: string | null;
  notes: string | null;
  /** Lead times (days) — the SKU's effective lead comes from its preferred supplier. */
  leadTimeSeaDays: number | null;
  leadTimeAirDays: number | null;
  active: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** SKU ↔ supplier link. is_preferred = the default supplier for "pedido por fornecedor". */
export interface SkuSupplier {
  skuBase: string;
  supplierId: string;
  isPreferred: boolean;
  priority: number;
  updatedAt: string;
  updatedBy: string | null;
}

// Bike-model families for the compatibility matrix. Consolidated to the two families
// Vammo actually plans against — CPX and COMFORT (the per-variant colours/versions and
// the legacy VS line were collapsed away). Legacy per-variant columns still exist in
// dev.fleet_part_compat and are folded into these two on read (see deriveModels).
export const BIKE_MODELS = ['cpx', 'comfort'] as const;

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
  /** Meta comercial: novas motos/mês como fração da frota (null = não informado). */
  commercialTargetPct: number | null;
  /** Churn: motos que saem/mês como fração da frota (null = não informado). */
  churnPct: number | null;
  asOfDate: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
