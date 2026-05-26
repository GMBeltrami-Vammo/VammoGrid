import { normalizeHubName } from '@/constants/hubs';
import type { DohStatus, InventoryItem } from '@/types';

const DOH_WARNING = Number(process.env.DOH_WARNING_THRESHOLD) || 14;
const DOH_CRITICAL = Number(process.env.DOH_CRITICAL_THRESHOLD) || 7;

function deriveDohStatus(doh: number | null): DohStatus {
  if (doh === null) return 'unknown';
  if (doh <= DOH_CRITICAL) return 'critical';
  if (doh <= DOH_WARNING) return 'warning';
  return 'ok';
}

// Resolves a key in a Metabase row regardless of exact column name casing/spacing.
// Metabase may return columns in Portuguese with spaces, accents, etc.
function pick(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  ...candidates: string[]
): unknown {
  for (const key of candidates) {
    if (row[key] !== undefined) return row[key];
  }
  // case-insensitive fallback
  const lower = candidates.map((c) => c.toLowerCase());
  const found = Object.keys(row).find((k) => lower.includes(k.toLowerCase()));
  return found ? row[found] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformInventoryRows(rows: Record<string, any>[]): InventoryItem[] {
  const items: InventoryItem[] = [];

  for (const row of rows) {
    // Try common column name variants from Metabase/Maestro
    const rawHub = String(pick(row, 'base', 'hub', 'local', 'Base', 'Hub') ?? '');
    const hubId = normalizeHubName(rawHub);

    if (!hubId) {
      // Unknown hub — skip but don't crash; operator can investigate via raw Metabase
      console.warn(`[transformer] Unknown hub name: "${rawHub}" — skipping row`);
      continue;
    }

    const rawDoh = pick(row, 'doh', 'DOH', 'dias_de_estoque', 'Dias de Estoque', 'days_on_hand');
    const doh = rawDoh !== null && rawDoh !== '' ? Number(rawDoh) : null;

    const qtyRaw = pick(
      row,
      'quantidade_disponivel',
      'qty_available',
      'estoque_disponivel',
      'Estoque Disponível',
      'disponivel',
    );

    const item: InventoryItem = {
      skuId: String(pick(row, 'sku_id', 'codigo', 'Código', 'item_id', 'id') ?? ''),
      skuName: String(
        pick(row, 'sku_name', 'nome', 'Nome', 'item_name', 'descricao', 'Descrição') ?? 'Sem nome',
      ),
      category: String(
        pick(row, 'categoria', 'category', 'Categoria', 'tipo', 'Tipo') ?? '',
      ),
      hubId,
      qtyAvailable: qtyRaw !== null && qtyRaw !== '' ? Number(qtyRaw) : 0,
      doh: isNaN(doh as number) ? null : doh,
      dohStatus: deriveDohStatus(isNaN(doh as number) ? null : doh),
      lastUpdated: String(
        pick(row, 'updated_at', 'data_atualizacao', 'Data', 'last_updated') ??
          new Date().toISOString(),
      ),
    };

    items.push(item);
  }

  return items;
}
