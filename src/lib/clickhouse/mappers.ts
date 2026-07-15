import { deriveModels } from '@/constants/models';
import type {
  FleetInfo,
  HubId,
  PartCompat,
  PrepStatus,
  PurchaseOrder,
  PurchaseOrderStatus,
  SkuSupplier,
  Supplier,
  SupplierKind,
} from '@/types';

// Row → domain mappers for the dev.fleet_* tables. ClickHouse (like the Supabase
// tables before it) returns snake_case columns; the app uses camelCase domain
// types. Shared by the /api/fleet/* route handlers that back the client read hooks.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapPurchaseOrderRow(row: Record<string, any>): PurchaseOrder {
  return {
    id: String(row.id),
    vo: row.vo ?? null,
    pedidoName: row.pedido_name ?? null,
    orderType: row.order_type === 'nacional' || row.order_type === 'internacional' ? row.order_type : null,
    sku: String(row.sku),
    skuName: row.sku_name ?? null,
    qtyOrdered: Number(row.qty_ordered) || 0,
    orderDate: String(row.order_date),
    eta: row.eta ?? null,
    leadTimeDays: row.lead_time_days != null ? Number(row.lead_time_days) : null,
    status: (row.status ?? 'ordered') as PurchaseOrderStatus,
    prepStatus: (row.prep_status ?? null) as PrepStatus | null,
    modal: row.modal ?? null,
    hubId: (row.hub_id ?? 'osasco') as HubId,
    notes: row.notes ?? null,
    source: row.source ?? 'manual',
    elaborationSnapshot: row.elaboration_snapshot ?? null,
    supplierId: row.supplier_id ?? null,
    supplierName: row.supplier_name ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function mapSupplierRow(row: Record<string, any>): Supplier {
  return {
    supplierId: String(row.supplier_id),
    name: String(row.name ?? ''),
    kind: (row.kind === 'nacional' ? 'nacional' : 'internacional') as SupplierKind,
    contact: row.contact ?? null,
    notes: row.notes ?? null,
    leadTimeSeaDays: row.lead_time_sea_days != null ? Number(row.lead_time_sea_days) : null,
    leadTimeAirDays: row.lead_time_air_days != null ? Number(row.lead_time_air_days) : null,
    active: row.active == null ? true : Boolean(row.active),
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}

export function mapSkuSupplierRow(row: Record<string, any>): SkuSupplier {
  return {
    skuBase: String(row.sku_base),
    supplierId: String(row.supplier_id),
    isPreferred: Boolean(row.is_preferred),
    priority: Number(row.priority) || 0,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}

export function mapPartCompatRow(row: Record<string, any>): PartCompat {
  return {
    sku: String(row.sku),
    description: row.description ?? null,
    partNumber: row.part_number ?? null,
    aplicacao: row.aplicacao ?? null,
    nacionalizado: Boolean(row.nacionalizado),
    models: deriveModels(row),
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}

export function mapFleetInfoRow(row: Record<string, any>): FleetInfo {
  return {
    segment: String(row.segment),
    currentSize: Number(row.current_size) || 0,
    monthlyGrowthRate: Number(row.monthly_growth_rate) || 0,
    commercialTargetPct: row.commercial_target_pct != null ? Number(row.commercial_target_pct) : null,
    churnPct: row.churn_pct != null ? Number(row.churn_pct) : null,
    asOfDate: row.as_of_date ?? null,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}
