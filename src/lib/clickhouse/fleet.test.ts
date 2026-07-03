import { describe, expect, it } from 'vitest';
import { fleetRowWhere } from './fleet';

// The WHERE-builder behind readFleetRow. A lossy/wrong match makes the caller see
// current=null, and the subsequent full-row upsert would blank untouched columns —
// so the escaping and matching rules are pinned here.

describe('fleetRowWhere', () => {
  it('builds a single-key equality', () => {
    expect(fleetRowWhere({ sku_base: 'VM-01-CAR0-3501' })).toBe(
      "sku_base = 'VM-01-CAR0-3501'",
    );
  });

  it('joins composite keys with AND', () => {
    expect(fleetRowWhere({ sku_base: 'VM-01-FRE0-1010', hub_id: 'osasco' })).toBe(
      "sku_base = 'VM-01-FRE0-1010' AND hub_id = 'osasco'",
    );
  });

  it('escapes single quotes in values (never breaks out of the literal)', () => {
    expect(fleetRowWhere({ key: "a'b''c" })).toBe("key = 'a''b''''c'");
  });

  it('rejects invalid column names (identifier whitelist)', () => {
    expect(() => fleetRowWhere({ 'sku_base; DROP TABLE x': 'v' })).toThrow(/Invalid fleet column/);
    expect(() => fleetRowWhere({ 'SkuBase': 'v' })).toThrow(/Invalid fleet column/);
    expect(() => fleetRowWhere({ '1col': 'v' })).toThrow(/Invalid fleet column/);
  });

  it('rejects an empty key set', () => {
    expect(() => fleetRowWhere({})).toThrow(/at least one key/);
  });
});
