import { describe, expect, it } from 'vitest';
import { groupBySupplier, preferredSupplierBySku } from './supplierGroups';
import type { SkuSupplier } from '@/types';

const link = (skuBase: string, supplierId: string, isPreferred = false, priority = 0): SkuSupplier => ({
  skuBase,
  supplierId,
  isPreferred,
  priority,
  supplierPartNumber: null,
  updatedAt: '',
  updatedBy: null,
});

describe('preferredSupplierBySku', () => {
  it('picks the is_preferred link when present', () => {
    const m = preferredSupplierBySku([link('A', 's1', false, 0), link('A', 's2', true, 9)]);
    expect(m.get('A')).toBe('s2');
  });

  it('falls back to the lowest-priority link when none is preferred', () => {
    const m = preferredSupplierBySku([link('A', 's1', false, 5), link('A', 's2', false, 2), link('A', 's3', false, 8)]);
    expect(m.get('A')).toBe('s2');
  });

  it('omits SKUs with no link', () => {
    const m = preferredSupplierBySku([link('A', 's1')]);
    expect(m.has('B')).toBe(false);
  });
});

describe('groupBySupplier', () => {
  const links = [link('A', 's1', true), link('B', 's1', true), link('C', 's2', true)];
  const pref = preferredSupplierBySku(links);

  it('groups all items of a supplier into ONE group (one pedido per fornecedor)', () => {
    // A→s1, C→s2, B→s1: s1 gets both A and B in a single group; first-seen order.
    const items = [{ skuBase: 'A' }, { skuBase: 'C' }, { skuBase: 'B' }];
    const groups = groupBySupplier(items, pref);
    expect(groups).toEqual([
      { supplierId: 's1', items: [{ skuBase: 'A' }, { skuBase: 'B' }] },
      { supplierId: 's2', items: [{ skuBase: 'C' }] },
    ]);
  });

  it('SKUs without a supplier fall into the null group', () => {
    const groups = groupBySupplier([{ skuBase: 'A' }, { skuBase: 'Z' }], pref);
    expect(groups.find((g) => g.supplierId === null)?.items).toEqual([{ skuBase: 'Z' }]);
  });
});
