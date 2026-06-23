import type { HubId, StockState } from '@/types/planning';

// Splits fleet-level demand to hubs. The authoritative key is each SKU's trailing
// per-location consumption share (from the IMS ledger USAGE_* deltas), supplied by
// the data adapter. When that is unavailable we fall back to the current on-hand
// distribution, then to an even split — both flagged as approximations.

const HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];

function normalize(s: Record<HubId, number>, sum: number): Record<HubId, number> {
  return {
    osasco: (s.osasco ?? 0) / sum,
    mooca: (s.mooca ?? 0) / sum,
    sbc: (s.sbc ?? 0) / sum,
  };
}

export function resolveShares(
  stock: StockState,
  provided?: Record<HubId, number> | null,
): Record<HubId, number> {
  if (provided) {
    const sum = HUBS.reduce((acc, h) => acc + (provided[h] ?? 0), 0);
    if (sum > 0) return normalize(provided, sum);
  }
  if (stock.total > 0) {
    return {
      osasco: stock.byHub.osasco / stock.total,
      mooca: stock.byHub.mooca / stock.total,
      sbc: stock.byHub.sbc / stock.total,
    };
  }
  return { osasco: 1 / 3, mooca: 1 / 3, sbc: 1 / 3 };
}
