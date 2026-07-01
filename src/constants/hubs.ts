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
