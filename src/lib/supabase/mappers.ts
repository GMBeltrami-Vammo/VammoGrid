import { BIKE_MODELS } from '@/types';
import type {
  BikeModel,
  FleetInfo,
  HubId,
  PartCompat,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@/types';

// Row → domain mappers. Supabase returns snake_case columns; the app uses
// camelCase domain types. Shared by the client read hooks.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapPurchaseOrderRow(row: Record<string, any>): PurchaseOrder {
  return {
    id: Number(row.id),
    vo: row.vo ?? null,
    sku: String(row.sku),
    skuName: row.sku_name ?? null,
    qtyOrdered: Number(row.qty_ordered) || 0,
    orderDate: String(row.order_date),
    eta: row.eta ?? null,
    leadTimeDays: row.lead_time_days != null ? Number(row.lead_time_days) : null,
    status: (row.status ?? 'ordered') as PurchaseOrderStatus,
    modal: row.modal ?? null,
    hubId: (row.hub_id ?? 'osasco') as HubId,
    notes: row.notes ?? null,
    source: row.source ?? 'manual',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function mapPartCompatRow(row: Record<string, any>): PartCompat {
  const models = {} as Record<BikeModel, boolean>;
  for (const m of BIKE_MODELS) models[m] = Boolean(row[m]);
  return {
    sku: String(row.sku),
    description: row.description ?? null,
    partNumber: row.part_number ?? null,
    aplicacao: row.aplicacao ?? null,
    nacionalizado: Boolean(row.nacionalizado),
    models,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}

export function mapFleetInfoRow(row: Record<string, any>): FleetInfo {
  return {
    segment: String(row.segment),
    currentSize: Number(row.current_size) || 0,
    monthlyGrowthRate: Number(row.monthly_growth_rate) || 0,
    asOfDate: row.as_of_date ?? null,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: row.updated_by ?? null,
  };
}
