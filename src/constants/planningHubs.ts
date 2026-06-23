import type { Hub, HubId } from '@/types/planning';

// Hub ⇄ IMS location_id mapping (validated against analytics.stg_ims_r__location).
// Osasco = central distribution + recovery hub. Osasco/SBC lack coords in IMS, so
// approximate lat/lng are configured here for the transfer network map.
export const HUBS: Record<HubId, Hub> = {
  osasco: { id: 'osasco', name: 'Osasco', locationId: 34, isCentral: true, lat: -23.5329, lng: -46.7916 },
  mooca: { id: 'mooca', name: 'Mooca', locationId: 1, isCentral: false, lat: -23.5705, lng: -46.6005 },
  sbc: { id: 'sbc', name: 'São Bernardo do Campo', locationId: 166, isCentral: false, lat: -23.6914, lng: -46.5646 },
};

export const HUB_LIST: Hub[] = Object.values(HUBS);

export const HUB_IDS: HubId[] = ['osasco', 'mooca', 'sbc'];

/** Reverse map IMS location_id → HubId. */
export const HUB_BY_LOCATION: Record<number, HubId> = {
  34: 'osasco',
  1: 'mooca',
  166: 'sbc',
};

/** Comma-separated location ids for SQL IN-clauses. */
export const HUB_LOCATION_IDS = HUB_LIST.map((h) => h.locationId).join(',');
