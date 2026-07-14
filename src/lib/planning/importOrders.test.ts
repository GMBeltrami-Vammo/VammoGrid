import { describe, expect, it } from 'vitest';
import { parseImportRows, toIsoDate } from './importOrders';

const OPTS = { orderDate: '2026-07-14', defaultLeadDays: 40 };

describe('toIsoDate', () => {
  it('passes ISO through', () => {
    expect(toIsoDate('2026-08-01')).toBe('2026-08-01');
    expect(toIsoDate('2026-08-01T00:00:00Z')).toBe('2026-08-01');
  });
  it('converts dd-mm-yyyy and dd/mm/yyyy', () => {
    expect(toIsoDate('01-08-2026')).toBe('2026-08-01');
    expect(toIsoDate('1/8/2026')).toBe('2026-08-01');
  });
  it('returns null for junk / empty', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('agosto')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('parseImportRows', () => {
  it('reads sku + quantidade with the canonical headers', () => {
    const r = parseImportRows([{ sku: 'VM-01-CAR0-3501', quantidade: 120 }], OPTS);
    expect(r.lines).toEqual([{ skuBase: 'VM-01-CAR0-3501', skuName: null, qty: 120, leadDays: 40 }]);
    expect(r.skipped).toBe(0);
  });

  it('accepts header aliases, case/accent/spacing-insensitive', () => {
    const r = parseImportRows(
      [{ ' Código ': 'vm-01-fre0-1010', QTD: '15', 'Descrição': 'Pastilha', 'Lead Time': 30 }],
      OPTS,
    );
    expect(r.lines).toEqual([
      { skuBase: 'VM-01-FRE0-1010', skuName: 'Pastilha', qty: 15, leadDays: 30 },
    ]);
  });

  it('derives leadDays from an ETA relative to the order date', () => {
    const r = parseImportRows([{ sku: 'X', qtd: 5, eta: '23-08-2026' }], OPTS);
    // 2026-07-14 → 2026-08-23 = 40 days
    expect(r.lines[0].leadDays).toBe(40);
  });

  it('row lead (days) wins over eta and over the default', () => {
    const r = parseImportRows([{ sku: 'X', qtd: 5, lead_dias: 12, eta: '23-08-2026' }], OPTS);
    expect(r.lines[0].leadDays).toBe(12);
  });

  it('falls back to defaultLeadDays when neither lead nor a valid eta is present', () => {
    const r = parseImportRows([{ sku: 'X', qtd: 5, eta: 'sem data' }], OPTS);
    expect(r.lines[0].leadDays).toBe(40);
  });

  it('skips rows without a SKU or with non-positive/invalid quantity, with warnings', () => {
    const r = parseImportRows(
      [
        { sku: '', quantidade: 10 },
        { sku: 'A', quantidade: 0 },
        { sku: 'B', quantidade: 'abc' },
        { sku: 'C', quantidade: 7 },
      ],
      OPTS,
    );
    expect(r.lines).toEqual([{ skuBase: 'C', skuName: null, qty: 7, leadDays: 40 }]);
    expect(r.skipped).toBe(3);
    expect(r.warnings).toHaveLength(3);
    // row numbering is 1-based + header row
    expect(r.warnings[0]).toContain('Linha 2');
  });

  it('rounds fractional quantities', () => {
    const r = parseImportRows([{ sku: 'X', quantidade: 12.6 }], OPTS);
    expect(r.lines[0].qty).toBe(13);
  });
});
