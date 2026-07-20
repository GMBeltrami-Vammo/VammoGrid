import { describe, expect, it } from 'vitest';
import { projectFromSeed, suggestCascadeQuantities, type MiniProjSeed, type InjectedReceipt } from './miniStrip';
import { forwardAvgDemand } from './projection';
import type { ModalPlan } from './elaboration';

const H = 147;
const TODAY = '2026-07-13';

function seed(start: number, rate = 1): MiniProjSeed {
  return {
    startStock: start,
    demandYhat: Array.from({ length: H + 1 }, (_, d) => (d === 0 ? 0 : rate)),
    modelHorizon: 90,
    receipts: {},
    recoveryRate: 0,
    recoveryTurnaround: 14,
    isRepairable: false,
    horizon: H,
  };
}

// Replica of the real loop with an iteration counter, to compare against the real fn.
function replicaCourier(s: MiniProjSeed, a: number, windowEnd: number, level: number, MAX: number) {
  const injected: InjectedReceipt[] = [];
  let qty = 0;
  const trace: string[] = [];
  let iters = 0;
  for (let iter = 0; iter < MAX; iter++) {
    iters++;
    const proj = projectFromSeed(s, qty > 0 ? [...injected, { offset: a, qty }] : injected, TODAY);
    let worst = 0;
    for (let d = a; d <= windowEnd; d++) {
      const rate = forwardAvgDemand(proj.timeline, d, 7);
      if (rate <= 0) continue;
      const need = level * rate - (proj.timeline[d]?.stock ?? 0);
      if (need > worst) worst = need;
    }
    trace.push(`iter${iter}: qty(before)=${qty.toFixed(2)} worst=${worst.toFixed(3)}`);
    if (worst <= 0.5) break;
    qty += worst;
  }
  return { qty: Math.max(0, Math.round(qty)), iters, trace };
}

describe('instrument', () => {
  it('replica vs real', () => {
    const out: string[] = [];
    const s = seed(30);
    const plans: ModalPlan[] = [
      { modal: { id: 'courier', name: 'Courier', leadDays: 3 }, minDoh: 15, cadenceDays: null, enabled: true },
      { modal: { id: 'sea', name: 'Marítimo', leadDays: 150 }, minDoh: 75, cadenceDays: 30, enabled: true },
    ];
    // courier: a=3, windowEnd=clamp(150)=147, level=15
    const rep8 = replicaCourier(s, 3, 147, 15, 8);
    out.push('REPLICA MAX=8: qty=' + rep8.qty + ' iters=' + rep8.iters);
    out.push(...rep8.trace.map((t) => '  ' + t));

    const real = suggestCascadeQuantities({ seed: s, plans, today: TODAY });
    out.push('REAL courier qty=' + real.find((x) => x.modalId === 'courier')!.qty);
    out.push('REAL sea qty=' + real.find((x) => x.modalId === 'sea')!.qty);

    require('fs').writeFileSync('sweep_out.txt', out.join('\n'));
    expect(true).toBe(true);
  });
});
