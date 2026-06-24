import type { HubId, SkuForecast, StockState, TransferSuggestion } from '@/types/planning';
import { addDays, diffDays } from './dates';
import { buildDailyDemand, type DailyDemand } from './forecast';

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Recommendation Engine — hub-and-spoke via Osasco, TWO weekly cycles.
//
// Cycle 1 (this Tuesday) and Cycle 2 (next Tuesday). Cycle 2 starts from the
// on-hand projected forward one cycle: minus a week of demand, plus the transfers
// suggested in cycle 1 (Osasco loses what it sends, spokes gain what they receive).
//
// Per cycle:
//  • Primary: if Osasco has surplus above its own coverage demand, distribute
//    pro-rata to any spoke short within its cycle window.
//  • Fallback (spoke-to-spoke): when Osasco can't supply, the other spoke shares
//    its surplus (lower confidence).
// ─────────────────────────────────────────────────────────────────────────────

const SPOKES: HubId[] = ['mooca', 'sbc'];
const ALL_HUBS: HubId[] = ['osasco', 'mooca', 'sbc'];
const CYCLES = 2;

export interface TransferConfig {
  cycleDays: number;
  transitDays: Record<HubId, number>;
  spokeToSpokeTransitDays: number;
  minQty: number;
}

export const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
  cycleDays: 7,
  transitDays: { osasco: 0, mooca: 1, sbc: 2 },
  spokeToSpokeTransitDays: 1,
  minQty: 1,
};

const HUB_LABEL: Record<HubId, string> = { osasco: 'Osasco', mooca: 'Mooca', sbc: 'SBC' };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

interface TransferInput {
  stock: StockState;
  forecast: SkuForecast | null;
  shares: Record<HubId, number>;
  today: string;
  asOfDate: string;
  config?: TransferConfig;
}

interface HubNeed {
  hub: HubId;
  need: number;
  needByDate: string | null;
  confidence: number;
}

// Demand over [dayStart+1 .. dayStart+coverage] at this hub's share.
function computeHubNeed(
  hub: HubId,
  onHand: number,
  share: number,
  fleet: DailyDemand,
  coverage: number,
  today: string,
  asOfDate: string,
  dayStart: number,
): HubNeed {
  let demandCov = 0;
  let cum = 0;
  let stockoutK: number | null = null;
  let bandRelSum = 0;
  for (let k = 1; k <= coverage; k++) {
    const d = dayStart + k;
    const yh = (fleet.yhat[d] ?? 0) * share;
    demandCov += yh;
    cum += yh;
    if (stockoutK === null && cum >= onHand && yh > 0) stockoutK = k;
    const band = ((fleet.hi[d] ?? 0) - (fleet.lo[d] ?? 0)) * share;
    bandRelSum += band / Math.max(yh, 0.001);
  }
  const bandRel = coverage > 0 ? bandRelSum / coverage : 1;
  const daysStale = Math.max(0, diffDays(asOfDate, today));
  const freshness = clamp(1 - daysStale / 30, 0.3, 1);
  const confidence = clamp((1 - bandRel / 2) * freshness, 0.1, 0.95);
  return {
    hub,
    need: Math.max(0, demandCov - onHand),
    needByDate: stockoutK != null ? addDays(today, dayStart + stockoutK) : null,
    confidence,
  };
}

// Suggestions for ONE cycle, given the on-hand at the cycle's start.
function cycleSuggestions(
  i: TransferInput,
  cfg: TransferConfig,
  fleet: DailyDemand,
  byHand: Record<HubId, number>,
  dayStart: number,
  cycle: number,
): TransferSuggestion[] {
  const osShare = i.shares.osasco ?? 0;
  const osCoverage = cfg.cycleDays + (cfg.transitDays.osasco ?? 0);
  let osDemandCov = 0;
  for (let k = 1; k <= osCoverage; k++) osDemandCov += (fleet.yhat[dayStart + k] ?? 0) * osShare;
  const osAvailable = Math.max(0, (byHand.osasco ?? 0) - osDemandCov);

  // ── Primary: Osasco → spokes ──────────────────────────────────────────────
  if (osAvailable > 0) {
    const needs: HubNeed[] = [];
    for (const h of SPOKES) {
      const coverage = cfg.cycleDays + (cfg.transitDays[h] ?? 0);
      const n = computeHubNeed(h, byHand[h] ?? 0, i.shares[h] ?? 0, fleet, coverage, i.today, i.asOfDate, dayStart);
      if (n.need > 0) needs.push(n);
    }
    if (needs.length === 0) return [];
    const totalNeed = needs.reduce((s, n) => s + n.need, 0);
    const out: TransferSuggestion[] = [];
    for (const n of needs) {
      const proRata = osAvailable * (n.need / totalNeed);
      const qty = Math.round(Math.min(n.need, proRata));
      if (qty < cfg.minQty) continue;
      out.push({
        skuBase: i.stock.skuBase,
        skuName: i.stock.skuName,
        qty,
        fromHub: 'osasco',
        toHub: n.hub,
        needByDate: n.needByDate,
        confidence: Math.round(n.confidence * 100) / 100,
        cycle,
        reason:
          `${HUB_LABEL[n.hub]} projeta faltar ${Math.round(n.need)} un. até ` +
          `${n.needByDate ?? 'fim do ciclo'}; Osasco tem ${Math.round(osAvailable)} acima do buffer → transferir ${qty}.`,
      });
    }
    return out;
  }

  // ── Fallback: spoke-to-spoke ──────────────────────────────────────────────
  const out: TransferSuggestion[] = [];
  for (const fromSpoke of SPOKES) {
    for (const toSpoke of SPOKES) {
      if (fromSpoke === toSpoke) continue;
      const fromShare = i.shares[fromSpoke] ?? 0;
      const toShare = i.shares[toSpoke] ?? 0;
      if (fromShare <= 0 || toShare <= 0) continue;

      const fromCoverage = cfg.cycleDays + cfg.spokeToSpokeTransitDays;
      let fromDemandCov = 0;
      for (let k = 1; k <= fromCoverage; k++) fromDemandCov += (fleet.yhat[dayStart + k] ?? 0) * fromShare;
      const fromAvailable = Math.max(0, (byHand[fromSpoke] ?? 0) - fromDemandCov);
      if (fromAvailable <= 0) continue;

      const toCoverage = cfg.cycleDays + cfg.spokeToSpokeTransitDays;
      const toNeed = computeHubNeed(
        toSpoke, byHand[toSpoke] ?? 0, toShare, fleet, toCoverage, i.today, i.asOfDate, dayStart,
      );
      if (toNeed.need <= 0) continue;

      const qty = Math.round(Math.min(toNeed.need, fromAvailable));
      if (qty < cfg.minQty) continue;

      out.push({
        skuBase: i.stock.skuBase,
        skuName: i.stock.skuName,
        qty,
        fromHub: fromSpoke,
        toHub: toSpoke,
        needByDate: toNeed.needByDate,
        confidence: Math.round(toNeed.confidence * 0.7 * 100) / 100,
        cycle,
        reason:
          `Osasco sem estoque disponível; ${HUB_LABEL[fromSpoke]} tem ${Math.round(fromAvailable)} ` +
          `acima do próprio buffer → cobrir ${HUB_LABEL[toSpoke]} (precisa ${Math.round(toNeed.need)}).`,
      });
    }
  }
  return out;
}

// Advance on-hand one cycle: subtract a week of demand per hub, then apply the
// transfers suggested in the cycle just computed.
function advanceCycle(
  byHand: Record<HubId, number>,
  fleet: DailyDemand,
  shares: Record<HubId, number>,
  cfg: TransferConfig,
  dayStart: number,
  suggestions: TransferSuggestion[],
): Record<HubId, number> {
  const next = { ...byHand };
  for (const h of ALL_HUBS) {
    let dem = 0;
    for (let k = 1; k <= cfg.cycleDays; k++) dem += (fleet.yhat[dayStart + k] ?? 0) * (shares[h] ?? 0);
    next[h] = Math.max(0, (next[h] ?? 0) - dem);
  }
  for (const t of suggestions) {
    next[t.fromHub] = Math.max(0, (next[t.fromHub] ?? 0) - t.qty);
    next[t.toHub] = (next[t.toHub] ?? 0) + t.qty;
  }
  return next;
}

export function transferForSku(i: TransferInput): TransferSuggestion[] {
  const cfg = i.config ?? DEFAULT_TRANSFER_CONFIG;
  if (!i.forecast) return [];

  const maxCoverage =
    cfg.cycleDays + Math.max(cfg.spokeToSpokeTransitDays, ...SPOKES.map((h) => cfg.transitDays[h] ?? 0));
  // Enough days for both cycles' windows.
  const fleet = buildDailyDemand(i.forecast, Math.max(60, CYCLES * cfg.cycleDays + maxCoverage + 1));

  const all: TransferSuggestion[] = [];
  let byHand: Record<HubId, number> = { ...i.stock.byHub };
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const dayStart = (cycle - 1) * cfg.cycleDays;
    const suggestions = cycleSuggestions(i, cfg, fleet, byHand, dayStart, cycle);
    all.push(...suggestions);
    if (cycle < CYCLES) byHand = advanceCycle(byHand, fleet, i.shares, cfg, dayStart, suggestions);
  }
  return all;
}

export function transferForAll(args: {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  sharesBySku: Map<string, Record<HubId, number>>;
  resolveShares: (stock: StockState) => Record<HubId, number>;
  today: string;
  asOfDate: string;
  config?: TransferConfig;
}): TransferSuggestion[] {
  const out: TransferSuggestion[] = [];
  for (const stock of args.stocks) {
    const suggestions = transferForSku({
      stock,
      forecast: args.forecasts.get(stock.skuBase) ?? null,
      shares: args.sharesBySku.get(stock.skuBase) ?? args.resolveShares(stock),
      today: args.today,
      asOfDate: args.asOfDate,
      config: args.config,
    });
    out.push(...suggestions);
  }
  return out;
}
