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
}

export interface ImportParseResult {
  lines: ParsedImportLine[];
  skipped: number;
  warnings: string[];
}

// Canonical field → accepted header names (normalized: lowercased, spaces→_, dots dropped).
const ALIASES: Record<'sku' | 'qty' | 'name' | 'eta' | 'lead', string[]> = {
  sku: ['sku', 'sku_base', 'skubase', 'codigo', 'cod', 'item', 'item_code'],
  qty: ['quantidade', 'qtd', 'qtde', 'qty', 'quantity'],
  name: ['nome_item', 'nome', 'descricao', 'item_name', 'name'],
  eta: ['eta', 'chegada', 'previsao', 'data_eta'],
  lead: ['lead_dias', 'lead', 'lead_time', 'lead_time_days', 'prazo', 'prazo_dias'],
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

/** Normalize a date cell (ISO, dd-mm-yyyy, or dd/mm/yyyy) to YYYY-MM-DD; null if unparseable. */
export function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
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
    });
  });

  return { lines, skipped, warnings };
}
