import { describe, expect, it } from 'vitest';
import { mapFleetHistoryRows } from './fleetHistoryWarehouse';

describe('mapFleetHistoryRows', () => {
  it('maps the two model names to CPX / COMFORT segments', () => {
    const out = mapFleetHistoryRows([
      { month_start: '2026-07-01', bike_model_name: 'VMOTO CPX', size: 2641 },
      { month_start: '2026-07-01', bike_model_name: 'VAMMO COMFORT', size: 5502 },
    ]);
    expect(out).toEqual([
      { segment: 'CPX', monthStart: '2026-07-01', size: 2641 },
      { segment: 'COMFORT', monthStart: '2026-07-01', size: 5502 },
    ]);
  });

  it('drops unknown models, non-positive sizes and malformed dates', () => {
    const out = mapFleetHistoryRows([
      { month_start: '2026-07-01', bike_model_name: 'VMOTO VS1', size: 5 }, // unknown → dropped
      { month_start: '2026-06-01', bike_model_name: 'VMOTO CPX', size: 0 }, // zero → dropped
      { month_start: 'not-a-date', bike_model_name: 'VMOTO CPX', size: 10 }, // bad date → dropped
    ]);
    expect(out).toEqual([]);
  });

  it('rounds and coerces string sizes', () => {
    const out = mapFleetHistoryRows([
      { month_start: '2026-05-01', bike_model_name: 'VMOTO CPX', size: '2859' },
    ]);
    expect(out).toEqual([{ segment: 'CPX', monthStart: '2026-05-01', size: 2859 }]);
  });
});
