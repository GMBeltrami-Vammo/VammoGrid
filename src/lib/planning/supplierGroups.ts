import type { SkuSupplier } from '@/types';

// Pure helpers behind "pedido por fornecedor" (review 4b) — no server/UI deps, so the
// grouping is unit-testable.

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
