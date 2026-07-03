import { describe, expect, it } from 'vitest';
import { decodeSkuChunks, encodeSkuChunks, MAX_SKU_CHUNKS } from './filter';

// The hand-picked selection is stored in compact, chunked cookies so it can exceed the
// ~4KB single-cookie limit (200+ SKUs). encode/decode must round-trip losslessly.

const many = (n: number) => Array.from({ length: n }, (_, i) => `VM-01-CAR0-${String(i).padStart(4, '0')}`);

describe('sku selection chunk cookies', () => {
  it('round-trips a small selection in a single chunk', () => {
    const skus = ['VM-01-CAR0-3501', 'VM-02-FRE0-1010'];
    const chunks = encodeSkuChunks(skus);
    expect(chunks.length).toBe(1);
    expect(decodeSkuChunks(chunks)).toEqual(skus);
  });

  it('splits a large selection (250+) across multiple chunks and round-trips', () => {
    const skus = many(250);
    const chunks = encodeSkuChunks(skus);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk stays under the cookie budget.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3500);
    expect(decodeSkuChunks(chunks)).toEqual(skus);
  });

  it('handles 500 SKUs (well past the old 100 cap)', () => {
    const skus = many(500);
    const chunks = encodeSkuChunks(skus);
    expect(chunks.length).toBeLessThanOrEqual(MAX_SKU_CHUNKS);
    expect(decodeSkuChunks(chunks)).toEqual(skus);
  });

  it('decode ignores empty/undefined chunk slots (cleared cookies)', () => {
    const chunks = encodeSkuChunks(['A-1', 'B-2', 'C-3']);
    expect(decodeSkuChunks([chunks[0], undefined, '', null])).toEqual(['A-1', 'B-2', 'C-3']);
  });

  it('empty selection encodes to no chunks and decodes to empty', () => {
    expect(encodeSkuChunks([])).toEqual([]);
    expect(decodeSkuChunks([undefined, undefined])).toEqual([]);
  });
});
