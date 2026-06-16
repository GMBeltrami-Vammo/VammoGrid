import type { BikeModel } from '@/types';

// Display labels for the bike-model compatibility columns. Order here drives the
// column order in the compatibility matrix UI.
export const MODEL_LABELS: Record<BikeModel, string> = {
  cpx_preta: 'CPX Preta',
  cpx_prata: 'CPX Prata',
  cpx_cinza: 'CPX Cinza',
  cpx_azul: 'CPX Azul',
  cpx_pro_azul: 'CPX Pro Azul',
  vs1_branco: 'VS1 Branco',
  vs2_preta: 'VS2 Preta',
  comfort_azul: 'COMFORT Azul',
  comfort_v2_azul: 'COMFORT V2 Azul',
};
