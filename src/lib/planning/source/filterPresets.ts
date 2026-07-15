import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import { mapFilterPresetRow } from '@/lib/clickhouse/mappers';
import type { FilterPreset } from '@/types';
import type { Row } from '@/lib/clickhouse/reader';

// Named selection presets (custom filters): saved SKU lists the team re-applies as
// the app-wide recorte. Fail-open: read errors return [] so pages still render.

const fetchRows = unstable_cache(
  async (): Promise<Row[]> => readFleetTable<Row>(FLEET_TABLES.filterPreset),
  ['filter-preset-rows'],
  { revalidate: 300, tags: ['filter-presets'] },
);

/** All presets, sorted by name. Empty on error. */
export async function fetchFilterPresets(): Promise<FilterPreset[]> {
  try {
    return (await fetchRows())
      .map(mapFilterPresetRow)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  } catch (e) {
    console.error('[fetchFilterPresets]', e instanceof Error ? e.message : e);
    return [];
  }
}
