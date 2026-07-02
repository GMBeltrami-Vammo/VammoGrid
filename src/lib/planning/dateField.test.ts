import { describe, expect, it } from 'vitest';
import { isoToDisplayDate, parseDisplayDate } from './format';

describe('isoToDisplayDate', () => {
  it('renders ISO as DD-MM-YYYY', () => {
    expect(isoToDisplayDate('2026-07-02')).toBe('02-07-2026');
  });
  it('returns empty for empty/invalid', () => {
    expect(isoToDisplayDate('')).toBe('');
    expect(isoToDisplayDate('nope')).toBe('');
  });
});

describe('parseDisplayDate', () => {
  it('parses DD-MM-YYYY (never MM-DD) → ISO', () => {
    // 02-07-2026 is 2 July, NOT 7 February.
    expect(parseDisplayDate('02-07-2026')).toBe('2026-07-02');
  });
  it('accepts slashes and single digits', () => {
    expect(parseDisplayDate('2/7/2026')).toBe('2026-07-02');
  });
  it('expands a 2-digit year to 20xx', () => {
    expect(parseDisplayDate('02-07-26')).toBe('2026-07-02');
  });
  it('rejects overflow dates (31-02) and out-of-range months/days', () => {
    expect(parseDisplayDate('31-02-2026')).toBeNull();
    expect(parseDisplayDate('00-07-2026')).toBeNull();
    expect(parseDisplayDate('02-13-2026')).toBeNull();
  });
  it('rejects incomplete input (no premature 3-digit-year match)', () => {
    expect(parseDisplayDate('02-07-202')).toBeNull();
    expect(parseDisplayDate('02-07')).toBeNull();
    expect(parseDisplayDate('')).toBeNull();
  });
  it('round-trips with isoToDisplayDate', () => {
    const iso = '2026-12-25';
    expect(parseDisplayDate(isoToDisplayDate(iso))).toBe(iso);
  });
});
