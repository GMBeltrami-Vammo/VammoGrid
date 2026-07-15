import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { mapSkuSupplierRow, mapSupplierModalRow, mapSupplierRow } from '@/lib/clickhouse/mappers';
import type { SkuSupplier, Supplier, SupplierModal } from '@/types';
import type { Row } from '@/lib/clickhouse/reader';

// Fornecedores + vínculos SKU↔fornecedor (review 4b). Cadastro only — read path for the
// Fornecedores page, the SKU cadastro links panel, and the Novo Pedido supplier grouping.
// Fail-open: a read error returns [] so the rest of the page still renders.

interface SupplierRow {
  supplier_id: string;
  name: string;
  kind: string;
  contact: string | null;
  notes: string | null;
  lead_time_sea_days: number | null;
  lead_time_air_days: number | null;
  active: boolean | number;
  updated_at: string;
  updated_by: string | null;
}

interface SkuSupplierRow {
  sku_base: string;
  supplier_id: string;
  is_preferred: boolean | number;
  priority: number;
  updated_at: string;
  updated_by: string | null;
}

const fetchSupplierRows = unstable_cache(
  async (): Promise<SupplierRow[]> => readFleetTable<SupplierRow>(FLEET_TABLES.supplier),
  ['supplier-rows'],
  { revalidate: 300, tags: ['suppliers'] },
);

const fetchSkuSupplierRows = unstable_cache(
  async (): Promise<SkuSupplierRow[]> => readFleetTable<SkuSupplierRow>(FLEET_TABLES.skuSupplier),
  ['sku-supplier-rows'],
  { revalidate: 300, tags: ['suppliers'] },
);

/** All suppliers, active first then by name. Empty on error. */
export async function fetchSuppliers(): Promise<Supplier[]> {
  try {
    const rows = await fetchSupplierRows();
    return rows
      .map(mapSupplierRow)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
  } catch (e) {
    console.error('[fetchSuppliers]', e instanceof Error ? e.message : e);
    return [];
  }
}

/** All SKU↔supplier links. Empty on error. */
export async function fetchSkuSuppliers(): Promise<SkuSupplier[]> {
  try {
    return (await fetchSkuSupplierRows()).map(mapSkuSupplierRow);
  } catch (e) {
    console.error('[fetchSkuSuppliers]', e instanceof Error ? e.message : e);
    return [];
  }
}

const fetchSupplierModalRows = unstable_cache(
  async (): Promise<Row[]> => readFleetTable<Row>(FLEET_TABLES.supplierModal),
  ['supplier-modal-rows'],
  { revalidate: 300, tags: ['suppliers'] },
);

/** All supplier modals, sorted by (supplier, sortOrder, lead desc). Empty on error. */
export async function fetchSupplierModals(): Promise<SupplierModal[]> {
  try {
    return (await fetchSupplierModalRows())
      .map(mapSupplierModalRow)
      .sort(
        (a, b) =>
          a.supplierId.localeCompare(b.supplierId) ||
          a.sortOrder - b.sortOrder ||
          b.leadDays - a.leadDays,
      );
  } catch (e) {
    console.error('[fetchSupplierModals]', e instanceof Error ? e.message : e);
    return [];
  }
}
