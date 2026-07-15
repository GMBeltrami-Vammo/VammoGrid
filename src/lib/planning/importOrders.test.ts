import { describe, expect, it } from 'vitest';
import { parseImportRows, parseWorkbook, toIsoDate, type CellGrid } from './importOrders';

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

// The real Vammo PO template: a header block on top (DATE, PURCHASE ORDER NO.) then an
// item table whose header row + columns are found by label (Dagster po_extract parity).
const VAMMO_PO: CellGrid = [
  ['VAMMO — PURCHASE ORDER', null, null, null],
  ['DATE', 'PURCHASE ORDER NO.', null, null], // header-block labels…
  ['01/08/2026', '276.1', null, null], // …values on the row below (real template layout)
  [null, null, null, null],
  ['ITEM NO.', 'SKU VAMMO', 'DESCRIPTION', 'QTY'],
  [1, 'vm-01-car0-3501', 'Paralama traseiro', 120],
  [2, 'VM-01-FRE0-1010', 'Pastilha', 15.4],
  [null, null, null, null], // blank row terminates
  ['Total', null, null, 135],
];

describe('parseWorkbook (Vammo PO template — Dagster parity)', () => {
  it('finds the item table by label + reads the header block (date, PO)', () => {
    const r = parseWorkbook([VAMMO_PO], { defaultLeadDays: 45 });
    expect(r.parsed).toBe(true);
    expect(r.orderDate).toBe('2026-08-01');
    expect(r.poNumber).toBe('276.1');
    expect(r.lines).toEqual([
      { skuBase: 'VM-01-CAR0-3501', skuName: 'Paralama traseiro', qty: 120, leadDays: 45 },
      { skuBase: 'VM-01-FRE0-1010', skuName: 'Pastilha', qty: 15, leadDays: 45 }, // rounded, uppercased
    ]);
  });

  it('stops at the first fully blank row (ignores totals/notes below)', () => {
    const r = parseWorkbook([VAMMO_PO], { defaultLeadDays: 45 });
    expect(r.lines).toHaveLength(2); // the "Total 135" row after the blank is not a line
  });

  it('reads a Date cell (SheetJS cellDates) in the header block', () => {
    const grid: CellGrid = [
      ['DATE', null],
      [new Date(Date.UTC(2026, 7, 1)), null], // value below the label
      ['SKU VAMMO', 'QTY'],
      ['VM-01-X', 3],
    ];
    expect(parseWorkbook([grid], { defaultLeadDays: 45 }).orderDate).toBe('2026-08-01');
  });

  it('picks the data tab among several sheets', () => {
    const cover: CellGrid = [['Instruções'], ['nada aqui']];
    const r = parseWorkbook([cover, VAMMO_PO], { defaultLeadDays: 60 });
    expect(r.parsed).toBe(true);
    expect(r.lines).toHaveLength(2);
  });

  it('also handles a plain flat sheet (SKU/QTY on the first row)', () => {
    const flat: CellGrid = [
      ['SKU', 'Quantidade'],
      ['VM-01-A', 10],
      ['VM-01-B', 20],
    ];
    const r = parseWorkbook([flat], { defaultLeadDays: 45 });
    expect(r.parsed).toBe(true);
    expect(r.lines.map((l) => l.skuBase)).toEqual(['VM-01-A', 'VM-01-B']);
    expect(r.orderDate).toBeNull(); // no header block
  });

  it('marks non-PO workbooks as not parsed', () => {
    const junk: CellGrid = [['Relatório'], ['coluna a', 'coluna b'], [1, 2]];
    const r = parseWorkbook([junk], { defaultLeadDays: 45 });
    expect(r.parsed).toBe(false);
    expect(r.lines).toHaveLength(0);
    expect(r.note).toBeTruthy();
  });

  it('skips invalid rows inside the table with warnings (does not stop)', () => {
    const grid: CellGrid = [
      ['SKU VAMMO', 'DESCRIPTION', 'QTY'],
      ['VM-01-A', 'ok', 5],
      [null, 'linha sem sku mas com desc', 3], // no SKU → skipped, not terminated
      ['VM-01-B', 'zero qty', 0], // invalid qty → skipped
      ['VM-01-C', 'ok', 7],
    ];
    const r = parseWorkbook([grid], { defaultLeadDays: 45 });
    expect(r.lines.map((l) => l.skuBase)).toEqual(['VM-01-A', 'VM-01-C']);
    expect(r.skipped).toBe(2);
    expect(r.warnings).toHaveLength(2);
  });
});
