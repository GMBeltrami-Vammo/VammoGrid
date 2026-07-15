import type { SkuSupplier, Supplier, SupplierModal } from '@/types';

// Pure helpers behind "pedido por fornecedor" (review 4b) — no server/UI deps, so the
// grouping is unit-testable.

/** One usable shipping option: a supplier modal with its lead. Ordered slow→fast by
 *  the helpers so callers can treat [0] as the bulk lane and [last] as the express. */
export interface ModalOption {
  id: string;
  name: string;
  leadDays: number;
}

/**
 * The modals a supplier offers, ordered by lead DESC (slowest/bulk first). Fallbacks
 * keep everything working during the transition:
 *  1. registered modals (dev.fleet_supplier_modal) — the real thing (VMoto: 105/45/15);
 *  2. the supplier's legacy lead_time_sea/air_days pair (Marítimo/Aéreo);
 *  3. [] — caller falls back to the SKU's own policy leads.
 */
export function modalsForSupplier(
  supplier: Pick<Supplier, 'supplierId' | 'leadTimeSeaDays' | 'leadTimeAirDays'> | null | undefined,
  modals: SupplierModal[],
): ModalOption[] {
  if (!supplier) return [];
  const own = modals
    .filter((m) => m.supplierId === supplier.supplierId && m.leadDays > 0)
    .map((m) => ({ id: m.modalId, name: m.name, leadDays: m.leadDays }));
  if (own.length > 0) return own.sort((a, b) => b.leadDays - a.leadDays);

  const legacy: ModalOption[] = [];
  if (supplier.leadTimeSeaDays != null && supplier.leadTimeSeaDays > 0) {
    legacy.push({ id: 'sea', name: 'Marítimo', leadDays: supplier.leadTimeSeaDays });
  }
  if (supplier.leadTimeAirDays != null && supplier.leadTimeAirDays > 0) {
    legacy.push({ id: 'air', name: 'Aéreo', leadDays: supplier.leadTimeAirDays });
  }
  return legacy.sort((a, b) => b.leadDays - a.leadDays);
}

/**
 * Preferred supplier per SKU: the is_preferred link, else the lowest-priority link,
 * else the first. SKUs with no link are absent from the map.
 */
export function preferredSupplierBySku(links: SkuSupplier[]): Map<string, string> {
  const bySku = new Map<string, SkuSupplier[]>();
  for (const l of links) {
    const arr = bySku.get(l.skuBase);
    if (arr) arr.push(l);
    else bySku.set(l.skuBase, [l]);
  }
  const out = new Map<string, string>();
  for (const [sku, ls] of bySku) {
    const pref = ls.find((l) => l.isPreferred) ?? [...ls].sort((a, b) => a.priority - b.priority)[0];
    if (pref) out.set(sku, pref.supplierId);
  }
  return out;
}

/**
 * Split items into one group per preferred supplier (null = no supplier), preserving
 * input order within each group. Used to create one pedido per fornecedor.
 */
export function groupBySupplier<T extends { skuBase: string }>(
  items: T[],
  prefBySku: Map<string, string>,
): { supplierId: string | null; items: T[] }[] {
  const groups = new Map<string | null, T[]>();
  const order: (string | null)[] = [];
  for (const it of items) {
    const sid = prefBySku.get(it.skuBase) ?? null;
    let arr = groups.get(sid);
    if (!arr) {
      arr = [];
      groups.set(sid, arr);
      order.push(sid);
    }
    arr.push(it);
  }
  return order.map((supplierId) => ({ supplierId, items: groups.get(supplierId)! }));
}
