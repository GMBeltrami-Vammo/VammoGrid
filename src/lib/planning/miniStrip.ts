import type { StockProjection } from '@/types/planning';
import { forwardAvgDemand, projectStream } from './projection';

// Client-safe engine reuse for the Novo Pedido builder (F5). The projection engine is
// modal-agnostic — a receipt is just (dayOffset, qty), timing comes 100% from eta/lead —
// so an N-modal order is simply N synthetic receipts. This lets the builder re-project a
// SKU live in the browser (com/sem pedido) using the REAL engine, touching neither the
// heatmap code nor its characterization snapshot.
//
// MiniProjSeed is the minimal serializable projection input the server (computeElaborations)
// ships per row. It lives HERE (client-safe) — load.ts (server-only) imports it, never the
// reverse — so importing it into a client component can't drag server-only code into the bundle.

export interface MiniProjSeed {
  /** Current global on-hand (stock.total). */
  startStock: number;
  /** Daily forecast demand (index 0 = today = 0), UNROUNDED — matches the engine exactly. */
  demandYhat: number[];
  /** Model horizon in days (days beyond it are extrapolated in the forecast). */
  modelHorizon: number;
  /** Sparse dayOffset → registered (baseline) inbound units, from the base projection. */
  receipts: Record<number, number>;
  recoveryRate: number;
  recoveryTurnaround: number;
  isRepairable: boolean;
  /** Projection length = miniWeeks*7 + 7 (the +7 keeps forwardAvgDemand's window full at
   *  the last sampled week, matching weekgrid's min(150, max(weeks*7+7,30))). */
  horizon: number;
}

/** One injected receipt (a modal's arrival): units landing `offset` days from today. */
export interface InjectedReceipt {
  offset: number;
  qty: number;
}

/**
 * Re-project a SKU from its seed + any injected (com-pedido) receipts, using the real
 * projectStream. `injected: []` gives the baseline (registered-orders-only) projection —
 * exactly what suggestQuantities expects as its incremental base.
 */
export function projectFromSeed(
  seed: MiniProjSeed,
  injected: InjectedReceipt[],
  today: string,
): StockProjection {
  const H = seed.horizon;
  const receipts = new Array<number>(H + 1).fill(0);
  for (const k in seed.receipts) {
    const d = Number(k);
    if (d >= 0 && d <= H) receipts[d] += seed.receipts[k];
  }
  for (const inj of injected) {
    const off = Math.round(inj.offset);
    if (off >= 0 && off <= H && inj.qty > 0) receipts[off] += inj.qty;
  }
  // The band (lo/hi) is unused by the central walk (it uses only yhat), so collapsing it
  // to yhat leaves stock/DOH identical to a full projection — correct, not an approximation.
  return projectStream({
    skuBase: '',
    skuName: '',
    scope: 'global',
    startStock: seed.startStock,
    demand: { yhat: seed.demandYhat, lo: seed.demandYhat, hi: seed.demandYhat, horizon: seed.modelHorizon, length: H },
    receipts,
    recoveryRate: seed.recoveryRate,
    recoveryTurnaround: seed.recoveryTurnaround,
    creditsRecovery: true,
    isRepairable: seed.isRepairable,
    today,
    horizon: H,
  });
}

export interface MiniCell {
  weekIdx: number;
  offset: number;
  stock: number;
  doh: number | null;
  isLow: boolean;
  isOut: boolean;
}

/** Sample a projection at the given day-offsets (0, 7, 14, …) into week cells — the same
 *  metric the Projeção Global heatmap shows (stock ÷ next-7-day avg demand). */
export function sampleMiniStrip(proj: StockProjection, weekOffsets: number[], floor: number): MiniCell[] {
  return weekOffsets.map((offset, weekIdx) => {
    const stock = proj.timeline[offset]?.stock ?? 0;
    const rate = forwardAvgDemand(proj.timeline, offset, 7);
    const doh = rate > 0 ? Math.round(stock / rate) : null;
    return { weekIdx, offset, stock, doh, isLow: doh != null && doh < floor, isOut: stock <= 0 };
  });
}

/** Lowest DOH over [0..horizonDays] — powers the "aparece se algum dia furar o DOH mínimo"
 *  filter (coverage horizon + min DOH). null when demand is zero throughout. */
export function minDohWithin(proj: StockProjection, horizonDays: number): number | null {
  let min: number | null = null;
  const last = Math.min(horizonDays, proj.timeline.length - 1);
  for (let d = 0; d <= last; d++) {
    const rate = forwardAvgDemand(proj.timeline, d, 7);
    if (rate <= 0) continue;
    const doh = proj.timeline[d].stock / rate;
    if (min == null || doh < min) min = doh;
  }
  return min;
}
