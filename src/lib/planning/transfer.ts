import type { HubId, SkuForecast, StockState, TransferSuggestion } from '@/types/planning';
import { addDays, diffDays } from './dates';
import { buildDailyDemand } from './forecast';

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Recommendation Engine — weekly, hub-and-spoke via Osasco.
//
// Primary path: if Osasco has surplus above its own safety buffer, distribute
// pro-rata to any spoke that will run short within the next cycle window.
//
// Fallback (spoke-to-spoke): when Osasco cannot supply a spoke (e.g. Osasco is
// also short), the engine checks whether the OTHER spoke has surplus it can
// share. These moves carry lower confidence and are rendered distinctly in the
// transfer map.
// ─────────────────────────────────────────────────────────────────────────────

const SPOKES: HubId[] = ['mooca', 'sbc'];

export interface TransferConfig {
  /** Days between transfer cycles (weekly = 7). */
  cycleDays: number;
  /** In-transit days for each leg. */
  transitDays: Record<HubId, number>;
  /** Transit days for spoke-to-spoke moves (default: 1). */
  spokeToSpokeTransitDays: number;
  /** Don't suggest a move below this quantity. */
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

// Compute how much a hub needs vs has over its replenishment window.
interface HubNeed {
  hub: HubId;
  need: number;
  onHand: number;
  demandCov: number;
  needByDate: string | null;
  confidence: number;
}

function computeHubNeed(
  hub: HubId,
  onHand: number,
  share: number,
  fleet: { yhat: number[]; lo: number[]; hi: number[] },
  coverage: number,
  today: string,
  asOfDate: string,
): HubNeed {
  let demandCov = 0;
  let cum = 0;
  let stockoutDay: number | null = null;
  let bandRelSum = 0;
  for (let d = 1; d <= coverage; d++) {
    const yh = (fleet.yhat[d] ?? 0) * share;
    demandCov += yh;
    cum += yh;
    if (stockoutDay === null && cum >= onHand && yh > 0) stockoutDay = d;
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
    onHand,
    demandCov,
    needByDate: stockoutDay != null ? addDays(today, stockoutDay) : null,
    confidence,
  };
}

export function transferForSku(i: TransferInput): TransferSuggestion[] {
  const cfg = i.config ?? DEFAULT_TRANSFER_CONFIG;
  if (!i.forecast) return [];

  const maxCoverage =
    cfg.cycleDays + Math.max(cfg.spokeToSpokeTransitDays, ...SPOKES.map((h) => cfg.transitDays[h] ?? 0));
  const fleet = buildDailyDemand(i.forecast, Math.max(60, maxCoverage + 1));

  // ── Primary path: Osasco → spokes ─────────────────────────────────────────
  const osShare = i.shares.osasco ?? 0;
  const osCoverage = cfg.cycleDays + (cfg.transitDays.osasco ?? 0);
  let osDemandCov = 0;
  for (let d = 1; d <= osCoverage; d++) osDemandCov += (fleet.yhat[d] ?? 0) * osShare;
  const osAvailable = Math.max(0, (i.stock.byHub.osasco ?? 0) - osDemandCov);

  if (osAvailable > 0) {
    const needs: HubNeed[] = [];
    for (const h of SPOKES) {
      const share = i.shares[h] ?? 0;
      const coverage = cfg.cycleDays + (cfg.transitDays[h] ?? 0);
      const n = computeHubNeed(h, i.stock.byHub[h] ?? 0, share, fleet, coverage, i.today, i.asOfDate);
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
        reason:
          `${HUB_LABEL[n.hub]} projeta faltar ${Math.round(n.need)} un. até ` +
          `${n.needByDate ?? 'fim do ciclo'}; Osasco tem ${Math.round(osAvailable)} acima do buffer → transferir ${qty}.`,
      });
    }
    return out;
  }

  // ── Fallback: spoke-to-spoke when Osasco cannot supply ────────────────────
  // Only triggered when Osasco's on-hand ≤ its own coverage demand.
  const out: TransferSuggestion[] = [];
  for (const fromSpoke of SPOKES) {
    for (const toSpoke of SPOKES) {
      if (fromSpoke === toSpoke) continue;
      const fromShare = i.shares[fromSpoke] ?? 0;
      const toShare = i.shares[toSpoke] ?? 0;
      if (fromShare <= 0 || toShare <= 0) continue;

      // fromSpoke surplus above its own cycle-window demand.
      const fromCoverage = cfg.cycleDays + cfg.spokeToSpokeTransitDays;
      let fromDemandCov = 0;
      for (let d = 1; d <= fromCoverage; d++) fromDemandCov += (fleet.yhat[d] ?? 0) * fromShare;
      const fromAvailable = Math.max(0, (i.stock.byHub[fromSpoke] ?? 0) - fromDemandCov);
      if (fromAvailable <= 0) continue;

      // toSpoke need.
      const toCoverage = cfg.cycleDays + cfg.spokeToSpokeTransitDays;
      const toNeed = computeHubNeed(
        toSpoke, i.stock.byHub[toSpoke] ?? 0, toShare, fleet, toCoverage, i.today, i.asOfDate,
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
        // Lower confidence: spoke-to-spoke is a fallback route
        confidence: Math.round(toNeed.confidence * 0.7 * 100) / 100,
        reason:
          `Osasco sem estoque disponível; ${HUB_LABEL[fromSpoke]} tem ${Math.round(fromAvailable)} ` +
          `acima do próprio buffer → cobrir ${HUB_LABEL[toSpoke]} (precisa ${Math.round(toNeed.need)}).`,
      });
    }
  }
  return out;
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
