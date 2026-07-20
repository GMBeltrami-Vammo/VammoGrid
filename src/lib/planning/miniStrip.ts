import type { StockProjection } from '@/types/planning';
import { forwardAvgDemand, projectStream } from './projection';
import type { ModalPlan, ModalQty } from './elaboration';

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

// ─── One-shot N-modal cascade (Novo Pedido builder) ────────────────────────────
// The quantity engine, RE-PROJECTING after every lane so the floored (lost-sales) walk
// is honoured. This replaces the old projection-based `suggestQuantities`, which sized each
// lane against ONE static baseline projection: a bridging lane whose window sat past the
// stockout read a baseline floored at 0 and, sized by deepest-shortfall-at-one-point,
// depleted across its window instead of holding its floor to the end (aéreo showed ~34 DOH
// where 75 was expected). Re-projecting each cumulative injection fixes that at the root.
//
// Cascade preference = fastest→slowest:
//   • each FASTER lane sustains its own piso (minDoh) from its arrival until the NEXT lane's
//     arrival — coverage lands at its piso exactly when the next lane comes in;
//   • the SLOWEST lane order-up-to (piso + cadência) at its arrival (the volume/sustainer).
// Each lane is sized against a fresh re-projection that already includes the faster lanes'
// injected units, via a fixed-point that fills the deepest DOH shortfall in the lane's window
// (robust to intermediate stockout flooring — a low-piso faster lane may re-floor mid-window).

const CASCADE_MAX_ITERS = 8;

export function suggestCascadeQuantities(args: {
  seed: MiniProjSeed;
  plans: ModalPlan[];
  today: string;
}): ModalQty[] {
  const lanes = args.plans
    .filter((p) => p.enabled && p.modal.leadDays >= 0)
    .map((p) => ({ ...p, arrival: Math.max(0, Math.round(p.modal.leadDays)) }))
    .sort((a, b) => a.arrival - b.arrival); // fastest first
  if (lanes.length === 0) return [];

  const H = args.seed.horizon;
  const clampDay = (d: number) => Math.max(0, Math.min(d, H));
  const injected: InjectedReceipt[] = [];
  const out: ModalQty[] = [];

  lanes.forEach((lane, i) => {
    const isSlowest = i === lanes.length - 1;
    const a = clampDay(lane.arrival);
    // Bridging lane holds its piso across [arrival, next arrival]; the slowest lane targets
    // just its arrival day, order-up-to (piso + cadência).
    const windowEnd = isSlowest ? a : clampDay(lanes[i + 1].arrival);
    const level = lane.minDoh + (isSlowest ? lane.cadenceDays ?? 0 : 0);

    // Fixed-point on the re-projection: measure the deepest unit shortfall below the target
    // over the window (on the floored walk that already carries the faster lanes + this lane's
    // running qty), add it, repeat. Converges monotonically from below (no overshoot).
    let qty = 0;
    for (let iter = 0; iter < CASCADE_MAX_ITERS; iter++) {
      const proj = projectFromSeed(
        args.seed,
        qty > 0 ? [...injected, { offset: a, qty }] : injected,
        args.today,
      );
      let worst = 0;
      for (let d = a; d <= windowEnd; d++) {
        const rate = forwardAvgDemand(proj.timeline, d, 7);
        if (rate <= 0) continue;
        const need = level * rate - (proj.timeline[d]?.stock ?? 0);
        if (need > worst) worst = need;
      }
      if (worst <= 0.5) break;
      qty += worst;
    }
    qty = Math.max(0, Math.round(qty));
    if (qty > 0) injected.push({ offset: a, qty });
    out.push({ modalId: lane.modal.id, modalName: lane.modal.name, qty, arrivalOffset: a });
  });
  return out;
}
