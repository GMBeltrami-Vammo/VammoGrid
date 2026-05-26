import type { Hub, HubId } from '@/types';

export const HUBS: Record<HubId, Hub> = {
  mooca: {
    id: 'mooca',
    name: 'Mooca',
    shortName: 'MOO',
    isRecoveryCenter: false,
  },
  osasco: {
    id: 'osasco',
    name: 'Osasco',
    shortName: 'OSA',
    isRecoveryCenter: true,
  },
  sbc: {
    id: 'sbc',
    name: 'São Bernardo do Campo',
    shortName: 'SBC',
    isRecoveryCenter: false,
  },
};

export const HUB_LIST: Hub[] = Object.values(HUBS);

// Maps Maestro/Metabase hub name strings to HubId (case-insensitive substring match)
const HUB_NAME_MAP: Array<{ patterns: string[]; id: HubId }> = [
  { patterns: ['mooca'], id: 'mooca' },
  { patterns: ['osasco'], id: 'osasco' },
  { patterns: ['bernardo', 'sbc', 's.b.c', 'sao bernardo'], id: 'sbc' },
];

export function normalizeHubName(raw: string): HubId | null {
  const lower = raw.toLowerCase();
  for (const entry of HUB_NAME_MAP) {
    if (entry.patterns.some((p) => lower.includes(p))) {
      return entry.id;
    }
  }
  return null;
}
