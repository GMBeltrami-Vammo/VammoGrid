import type { HubId, SkuForecast, StockState, TransferSuggestion } from '@/types/planning';
import { addDays, diffDays } from './dates';
import { buildDailyDemand } from './forecast';

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Recommendation Engine — weekly, hub-and-spoke via Osasco.
//
// For each spoke hub (Mooca, SBC) we project local demand over the replenishment
// window (cycle + transit). If a hub will not cover that window from its own stock,
// it has a Need. Osasco's surplus above its own coverage is the Availability. We
// distribute Availability across spoke Needs pro-rata, suggesting only moves that
// clear the minimum batch. Spoke→spoke moves are never suggested (central model);
// if Osasco itself is short, no transfer is emitted (the purchase engine acts).
// ─────────────────────────────────────────────────────────────────────────────

const SPOKES: HubId[] = ['mooca', 'sbc'];

export interface TransferConfig {
  /** Days between transfer cycles (weekly = 7). */
  cycleDays: number;
  /** In-transit days Osasco → each spoke. */
  transitDays: Record<HubId, number>;
  /** Don't suggest a move below this quantity. */
  minQty: number;
}

export const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
  cycleDays: 7,
  transitDays: { osasco: 0, mooca: 1, sbc: 2 },
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

export function transferForSku(i: TransferInput): TransferSuggestion[] {
  const cfg = i.config ?? DEFAULT_TRANSFER_CONFIG;
  if (!i.forecast) return []; // no demand signal → no basis to move stock

  const maxCoverage = cfg.cycleDays + Math.max(...SPOKES.map((h) => cfg.transitDays[h] ?? 0));
  const fleet = buildDailyDemand(i.forecast, Math.max(60, maxCoverage + 1));

  // Osasco surplus above its own coverage.
  const osShare = i.shares.osasco ?? 0;
  const osCoverage = cfg.cycleDays + (cfg.transitDays.osasco ?? 0);
  let osDemandCov = 0;
  for (let d = 1; d <= osCoverage; d++) osDemandCov += (fleet.yhat[d] ?? 0) * osShare;
  const available = Math.max(0, (i.stock.byHub.osasco ?? 0) - osDemandCov);
  if (available <= 0) return [];

  // Each spoke's need over its replenishment window.
  const needs: { hub: HubId; need: number; needByDate: string | null; confidence: number }[] = [];
  for (const h of SPOKES) {
    const share = i.shares[h] ?? 0;
    const coverage = cfg.cycleDays + (cfg.transitDays[h] ?? 0);
    const onHand = i.stock.byHub[h] ?? 0;

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
    const need = Math.max(0, demandCov - onHand);
    if (need <= 0) continue;

    const bandRel = coverage > 0 ? bandRelSum / coverage : 1;
    const daysStale = Math.max(0, diffDays(i.asOfDate, i.today));
    const freshness = clamp(1 - daysStale / 30, 0.3, 1);
    const confidence = clamp((1 - bandRel / 2) * freshness, 0.1, 0.95);

    needs.push({
      hub: h,
      need,
      needByDate: stockoutDay != null ? addDays(i.today, stockoutDay) : null,
      confidence,
    });
  }

  const totalNeed = needs.reduce((s, n) => s + n.need, 0);
  if (totalNeed <= 0) return [];

  const out: TransferSuggestion[] = [];
  for (const n of needs) {
    const proRata = available * (n.need / totalNeed);
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
        `${n.needByDate ?? 'fim do ciclo'}; Osasco tem ${Math.round(available)} acima do próprio buffer ` +
        `→ transferir ${qty}.`,
    });
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
