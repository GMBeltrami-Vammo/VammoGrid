import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { mapSkuSupplierRow, mapSupplierRow } from '@/lib/clickhouse/mappers';
import type { SkuSupplier, Supplier } from '@/types';

// Fornecedores + vínculos SKU↔fornecedor (review 4b). Cadastro only — read path for the
// Fornecedores page, the SKU cadastro links panel, and the Novo Pedido supplier grouping.
// Fail-open: a read error returns [] so the rest of the page still renders.

interface SupplierRow {
  supplier_id: string;
  name: string;
  kind: string;
  contact: string | null;
  notes: string | null;
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
