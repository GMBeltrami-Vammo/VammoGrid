import 'server-only';
import { unstable_cache } from 'next/cache';
import { FLEET_TABLES, readFleetTable } from '@/lib/clickhouse/fleet';
import {
  DEFAULT_SERVICE_LEVEL_TIER,
  SERVICE_LEVEL_TIER_KEY,
  SERVICE_LEVEL_Z,
  isServiceLevelTier,
  type ServiceLevelTier,
} from '../constants';

// App-wide key/value settings from dev.fleet_global_settings (sub-projects B1, E1).
// value is stored as a JSON string; callers parse per key. Cached across requests,
// busted via revalidateTag('global-settings') on every write.

export interface GlobalSettingRow {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

const fetchSettingsRows = unstable_cache(
  async (): Promise<GlobalSettingRow[]> => readFleetTable<GlobalSettingRow>(FLEET_TABLES.globalSettings),
  ['global-settings-rows'],
  { revalidate: 300, tags: ['global-settings'] },
);

/** Raw settings as a Map<key, rawJsonValue>. Empty on error. */
export async function fetchGlobalSettings(): Promise<Map<string, string>> {
  try {
    const rows = await fetchSettingsRows();
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch (e) {
    console.error('[fetchGlobalSettings]', e instanceof Error ? e.message : e);
    return new Map();
  }
}

/** The active global service-level tier (defaults to Base when unset/invalid). */
export async function fetchServiceLevelTier(): Promise<ServiceLevelTier> {
  const settings = await fetchGlobalSettings();
  const raw = settings.get(SERVICE_LEVEL_TIER_KEY);
  if (!raw) return DEFAULT_SERVICE_LEVEL_TIER;
  try {
    const parsed = JSON.parse(raw);
    return isServiceLevelTier(parsed) ? parsed : DEFAULT_SERVICE_LEVEL_TIER;
  } catch {
    // value may have been stored as a bare string rather than JSON
    return isServiceLevelTier(raw) ? raw : DEFAULT_SERVICE_LEVEL_TIER;
  }
}

/** z-score for the active tier — the single service-level dial applied to every SKU. */
export async function fetchServiceLevelZ(): Promise<number> {
  return SERVICE_LEVEL_Z[await fetchServiceLevelTier()];
}
