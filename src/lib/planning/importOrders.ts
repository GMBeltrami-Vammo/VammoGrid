import { diffDays } from './dates';

// Pure parser for the "Importar pedido (.xlsx)" flow (review item 3a). The client
// reads the workbook with SheetJS (dynamic import) into plain row objects; this module
// turns those into pedido lines — no xlsx/server dependency, so it's unit-testable.
// The pedido header (name/type/modal/order date) comes from the dialog; per line we
// only need SKU + quantity, with an optional ETA/lead to set each line's arrival.

export interface ParsedImportLine {
  skuBase: string;
  skuName: string | null;
  qty: number;
  /** Days from the (header) order date to arrival — from the row's lead/eta, else default. */
  leadDays: number;
  /** Supplier part number read from the template's PART NUMBER column (Notas P3). */
  partNumber: string | null;
}

export interface ImportParseResult {
  lines: ParsedImportLine[];
  skipped: number;
  warnings: string[];
}

// Canonical field → accepted header names (normalized: lowercased, spaces→_, dots dropped).
const ALIASES: Record<'sku' | 'qty' | 'name' | 'eta' | 'lead' | 'part', string[]> = {
  sku: ['sku', 'sku_base', 'skubase', 'codigo', 'cod', 'item', 'item_code'],
  qty: ['quantidade', 'qtd', 'qtde', 'qty', 'quantity'],
  name: ['nome_item', 'nome', 'descricao', 'item_name', 'name'],
  eta: ['eta', 'chegada', 'previsao', 'data_eta'],
  lead: ['lead_dias', 'lead', 'lead_time', 'lead_time_days', 'prazo', 'prazo_dias'],
  part: ['part_number', 'partnumber', 'part_no', 'pn', 'codigo_fornecedor', 'part'],
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (descrição → descricao)
    .replace(/\s+/g, '_')
    .replace(/\./g, '');
}

const HEADER_TO_FIELD: Record<string, keyof typeof ALIASES> = (() => {
  const m: Record<string, keyof typeof ALIASES> = {};
  for (const field of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    for (const alias of ALIASES[field]) m[alias] = field;
  }
  return m;
})();

/** Map one raw row (arbitrary header keys) to the canonical fields present. */
function pickFields(row: Record<string, unknown>): Partial<Record<keyof typeof ALIASES, unknown>> {
  const out: Partial<Record<keyof typeof ALIASES, unknown>> = {};
  for (const [key, value] of Object.entries(row)) {
    const field = HEADER_TO_FIELD[norm(key)];
    if (field && out[field] === undefined) out[field] = value;
  }
  return out;
}

/** Normalize a date cell (Date, ISO, dd-mm-yyyy, or dd/mm/yyyy) to YYYY-MM-DD; null if
 *  unparseable. Handles the Date objects SheetJS returns with `cellDates: true`. */
export function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS date cells are UTC-midnight — read the UTC parts to avoid a TZ off-by-one.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Parse spreadsheet rows into pedido lines. Rows without a SKU or a positive quantity
 * are dropped (counted + warned). Line lead time: the row's `lead` (days) if numeric,
 * else derived from the row's `eta` relative to `orderDate`, else `defaultLeadDays`.
 */
export function parseImportRows(
  rows: Record<string, unknown>[],
  opts: { orderDate: string; defaultLeadDays: number },
): ImportParseResult {
  const lines: ParsedImportLine[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const defLead = Math.max(0, Math.round(opts.defaultLeadDays));

  rows.forEach((row, i) => {
    const f = pickFields(row);
    const rowNum = i + 2; // +1 for 0-index, +1 for the header row

    const skuBase = f.sku != null ? String(f.sku).trim().toUpperCase() : '';
    const qtyRaw = f.qty != null ? Number(f.qty) : NaN;
    const qty = Number.isFinite(qtyRaw) ? Math.round(qtyRaw) : NaN;

    if (!skuBase) {
      skipped++;
      warnings.push(`Linha ${rowNum}: sem SKU — ignorada.`);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      skipped++;
      warnings.push(`Linha ${rowNum} (${skuBase}): quantidade inválida — ignorada.`);
      return;
    }

    let leadDays = defLead;
    const leadRaw = f.lead != null ? Number(f.lead) : NaN;
    if (Number.isFinite(leadRaw) && leadRaw >= 0) {
      leadDays = Math.round(leadRaw);
    } else {
      const etaIso = toIsoDate(f.eta);
      if (etaIso) {
        const d = diffDays(opts.orderDate, etaIso);
        if (d >= 0) leadDays = d;
      }
    }

    lines.push({
      skuBase,
      skuName: f.name != null && String(f.name).trim() !== '' ? String(f.name).trim() : null,
      qty,
      leadDays,
      partNumber: f.part != null && String(f.part).trim() !== '' ? String(f.part).trim() : null,
    });
  });

  return { lines, skipped, warnings };
}

// ─── Real Vammo PO template parser (ported from the Dagster po_extract.py) ──────────
// The POs follow one template: a data tab with a header block on top (DATE, PURCHASE
// ORDER NO.) and an "ITEM NO. | SKU VAMMO | PART NUMBER | DESCRIPTION | … | QTY" table
// below. Tab names, the header-row position and column order drift between workbooks, so
// nothing is keyed by cell address: the data sheet + header row are found by matching
// column labels (accent/case-insensitive substring); order date / PO number are read
// from the header block; the item table ends at the first fully blank row. This is the
// same logic the Dagster ingest uses for dev.vmoto_orders — so a PO that syncs cleanly
// there also imports cleanly here.

/** One sheet as a grid of raw cell values (SheetJS sheet_to_json with header:1). */
export type CellGrid = unknown[][];

type Canonical = 'sku' | 'part_number' | 'item_name' | 'quantity' | 'item_no';

// Ordered keyword → canonical column (first substring match wins; each canonical once).
const COLUMN_KEYWORDS: [string, Canonical][] = [
  ['part number', 'part_number'], // before 'sku' cannot match here, but keep specific first
  ['sku', 'sku'], // "SKU VAMMO"
  ['description', 'item_name'],
  ['descricao', 'item_name'], // PT-BR fallback
  ['quantidade', 'quantity'],
  ['quantity', 'quantity'],
  ['qty', 'quantity'],
  ['item no', 'item_no'], // "ITEM NO."
];
const REQUIRED_COLUMNS: Canonical[] = ['sku', 'quantity'];
const DATE_LABELS = ['date', 'data'];
const PO_LABELS = ['purchase order no', 'purchase order', 'pedido'];

function normLabel(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlankCell(v: unknown): boolean {
  return v == null || String(v).trim() === '';
}

/** Map the columns of one row to canonical fields (first keyword match, unique). */
function mapHeaderRow(row: unknown[]): Map<number, Canonical> {
  const colMap = new Map<number, Canonical>();
  const used = new Set<Canonical>();
  for (let c = 0; c < row.length; c++) {
    const label = normLabel(row[c]);
    if (!label) continue;
    for (const [kw, canon] of COLUMN_KEYWORDS) {
      if (label.includes(kw) && !used.has(canon)) {
        colMap.set(c, canon);
        used.add(canon);
        break;
      }
    }
  }
  return colMap;
}

/** Best (sheet, header row, column map) across all sheets — the row covering the most
 *  canonical columns, requiring at least SKU + quantity. */
function findSheetAndHeader(
  sheets: CellGrid[],
): { grid: CellGrid; headerRow: number; colMap: Map<number, Canonical> } | null {
  let best: { n: number; grid: CellGrid; headerRow: number; colMap: Map<number, Canonical> } | null = null;
  for (const grid of sheets) {
    const maxR = Math.min(grid.length, 50);
    for (let r = 0; r < maxR; r++) {
      const colMap = mapHeaderRow(grid[r] ?? []);
      const canons = new Set(colMap.values());
      if (!REQUIRED_COLUMNS.every((x) => canons.has(x))) continue;
      if (!best || canons.size > best.n) best = { n: canons.size, grid, headerRow: r, colMap };
    }
  }
  return best ? { grid: best.grid, headerRow: best.headerRow, colMap: best.colMap } : null;
}

/** A header-block label above the table → the cell below it, else to its right. */
function valueForLabel(grid: CellGrid, headerRow: number, labels: string[]): unknown {
  for (let r = 0; r < headerRow; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const label = normLabel(row[c]);
      if (label && labels.some((kw) => label === kw || label.startsWith(kw))) {
        const below = grid[r + 1]?.[c];
        if (!isBlankCell(below)) return below;
        const right = row[c + 1];
        if (!isBlankCell(right)) return right;
      }
    }
  }
  return null;
}

export interface WorkbookParseResult extends ImportParseResult {
  /** True when a recognizable item table was found (else it's not a PO workbook). */
  parsed: boolean;
  /** Order date read from the header block (YYYY-MM-DD), else null. */
  orderDate: string | null;
  /** Purchase-order number (VO) read from the header block, else null. */
  poNumber: string | null;
  note?: string;
}

/**
 * Parse a whole workbook (all sheets as cell grids) using the real Vammo PO template —
 * the Dagster extraction logic. Returns the header-block order date + PO number and the
 * line items. Per-line lead time isn't in the template, so every line uses
 * `defaultLeadDays` (from the dialog's modal). Also handles a plain flat sheet (SKU/QTY
 * labels on the first row) — that's just a header row at r=0 with no header block.
 */
export function parseWorkbook(
  sheets: CellGrid[],
  opts: { defaultLeadDays: number },
): WorkbookParseResult {
  const defLead = Math.max(0, Math.round(opts.defaultLeadDays));
  const found = findSheetAndHeader(sheets);
  if (!found) {
    return {
      parsed: false,
      orderDate: null,
      poNumber: null,
      lines: [],
      skipped: 0,
      warnings: [],
      note: 'Nenhuma tabela de itens reconhecível (colunas SKU e Quantidade). Não parece um pedido.',
    };
  }
  const { grid, headerRow, colMap } = found;
  const cols: Partial<Record<Canonical, number>> = {};
  for (const [idx, canon] of colMap) cols[canon] = idx;

  const orderDate = toIsoDate(valueForLabel(grid, headerRow, DATE_LABELS));
  const poRaw = valueForLabel(grid, headerRow, PO_LABELS);
  const poNumber = isBlankCell(poRaw) ? null : String(poRaw).trim();

  const lines: ParsedImportLine[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cell = (canon: Canonical) => (cols[canon] != null ? row[cols[canon]!] : null);
    const sku = cell('sku');
    const qtyCell = cell('quantity');
    const name = cell('item_name');
    const itemNo = cell('item_no');
    const part = cell('part_number');

    // A fully blank row terminates the table (notes/totals live below it).
    if ([sku, qtyCell, name, itemNo, part].every(isBlankCell)) break;
    // A row with neither SKU nor description is noise inside the table — skip, don't stop.
    if (isBlankCell(sku) && isBlankCell(name)) continue;

    const skuBase = isBlankCell(sku) ? '' : String(sku).trim().toUpperCase();
    const qtyNum = isBlankCell(qtyCell) ? NaN : Number(qtyCell);
    const qty = Number.isFinite(qtyNum) ? Math.round(qtyNum) : NaN;

    if (!skuBase) {
      skipped++;
      warnings.push(`Linha ${r + 1}: sem SKU — ignorada.`);
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      skipped++;
      warnings.push(`Linha ${r + 1} (${skuBase}): quantidade inválida — ignorada.`);
      continue;
    }
    lines.push({
      skuBase,
      skuName: isBlankCell(name) ? null : String(name).trim(),
      qty,
      leadDays: defLead,
      partNumber: isBlankCell(part) ? null : String(part).trim(),
    });
  }

  return {
    parsed: true,
    orderDate,
    poNumber,
    lines,
    skipped,
    warnings,
    note: lines.length === 0 ? 'Cabeçalho encontrado, mas nenhuma linha de item válida.' : undefined,
  };
}
