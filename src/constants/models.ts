import type { BikeModel } from '@/types';

// Display labels for the bike-model compatibility columns. Order here drives the
// column order in the compatibility matrix UI. Consolidated to CPX / COMFORT.
export const MODEL_LABELS: Record<BikeModel, string> = {
  cpx: 'CPX',
  comfort: 'COMFORT',
};

// Legacy per-variant compat columns (pre-consolidation). Kept only to derive the
// consolidated cpx/comfort flags for rows saved before the rollup — new writes set
// `cpx`/`comfort` directly. The old VS1/VS2 columns are intentionally dropped.
const LEGACY_CPX_COLS = ['cpx_preta', 'cpx_prata', 'cpx_cinza', 'cpx_azul', 'cpx_pro_azul'];
const LEGACY_COMFORT_COLS = ['comfort_azul', 'comfort_v2_azul'];

/**
 * Consolidated model flags for a part_compat row: prefer the new cpx/comfort columns,
 * else fall back to OR-ing the legacy per-variant columns. Lets pre-migration rows
 * keep showing correct compatibility until they're next edited.
 */
export function deriveModels(row: Record<string, unknown>): Record<BikeModel, boolean> {
  const cpx = row.cpx === true || LEGACY_CPX_COLS.some((c) => row[c] === true);
  const comfort = row.comfort === true || LEGACY_COMFORT_COLS.some((c) => row[c] === true);
  return { cpx, comfort };
}
