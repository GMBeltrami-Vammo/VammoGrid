import { describe, expect, it } from 'vitest';
import type { SkuForecast, SkuPolicy, StockState, HubId, OpenPurchaseOrder } from '@/types/planning';
import { toSkuBase } from './sku';
import { addDays } from './dates';
import { purchaseForSku } from './purchase';
import { projectSku } from './projection';
import { transferForSku } from './transfer';

const TODAY = '2026-06-23';

function forecast(yhat: number, hi: number, days = 150): SkuForecast {
  return {
    skuBase: 'X',
    asOfDate: TODAY,
    abcClass: 'C',
    modelVersion: 'test',
    horizonDays: days,
    points: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      date: addDays(TODAY, i + 1),
      yhat,
      lo: Math.max(0, yhat - (hi - yhat)),
      hi,
    })),
  };
}

function stock(total: number, byHub?: Partial<Record<HubId, number>>): StockState {
  const h = { osasco: total, mooca: 0, sbc: 0, ...byHub } as Record<HubId, number>;
  return {
    skuBase: 'X',
    skuName: 'Peça X',
    byHub: h,
    total: h.osasco + h.mooca + h.sbc,
    unitPrice: 10,
    isRepairable: false,
    category: null,
    lastUpdated: TODAY,
  };
}

function policy(over: Partial<SkuPolicy> = {}): SkuPolicy {
  return {
    skuBase: 'X',
    leadTimeDays: 10,
    leadTimeSource: 'international-default',
    leadTimeSeaDays: 110,
    leadTimeAirDays: 40,
    defaultModal: 'sea',
    abcClass: 'C',
    targetDoi: 60,
    recoveryRate: 0,
    recoveryTurnaroundDays: 14,
    safetyOverride: null,
    isRepairable: false,
    updatedBy: null,
    updatedAt: TODAY,
    ...over,
  };
}

describe('toSkuBase', () => {
  it('keeps the first 4 segments of a 6-segment sku_code', () => {
    expect(toSkuBase('VM-01-BAT0-0007-01-01')).toBe('VM-01-BAT0-0007');
  });
  it('returns short codes unchanged', () => {
    expect(toSkuBase('VM-01-FRE0-1005')).toBe('VM-01-FRE0-1005');
    expect(toSkuBase('ABC')).toBe('ABC');
  });
});

describe('purchaseForSku — ports the lab (s,S) policy', () => {
  // yhat=2/day, hi=4 → over L=10: expected_lt=20, sigma=(40-20)/1.28, safety=1.28*sigma=20, ROP=40.
  it('computes ROP, order-up-to and reorder qty', () => {
    const p = purchaseForSku({
      skuBase: 'X',
      skuName: 'Peça X',
      forecast: forecast(2, 4),
      stock: stock(30),
      orders: [],
      policy: policy(),
      today: TODAY,
    });
    expect(p.expectedLeadTimeDemand).toBe(20);
    expect(p.safetyStock).toBe(20);
    expect(p.rop).toBe(40);
    expect(p.status).toBe('REORDER'); // 30 < ROP 40
    // order_up_to = cumD[70]=140 + safety 20 = 160; qty = 160 − 30 − 0
    expect(p.orderQty).toBe(130);
    expect(p.estCost).toBe(1300);
    // stockout at day 15 (30 / 2), buy-by = 15 − 10
    expect(p.stockoutDate).toBe(addDays(TODAY, 15));
    expect(p.buyByDate).toBe(addDays(TODAY, 5));
    expect(p.isLate).toBe(false);
  });

  it('flags buy-by in the past as LATE (long lead, low stock)', () => {
    const p = purchaseForSku({
      skuBase: 'X',
      skuName: 'Peça X',
      forecast: forecast(2, 4),
      stock: stock(10),
      orders: [],
      policy: policy({ leadTimeDays: 20 }),
      today: TODAY,
    });
    expect(p.status).toBe('CRITICAL'); // 10 < expected_lt(40)
    expect(p.isLate).toBe(true);
  });

  it('nets open-PO receipts out of the suggested quantity', () => {
    const order: OpenPurchaseOrder = {
      id: 1, vo: '1', skuCode: 'X', skuBase: 'X', skuName: 'X', qty: 50,
      orderDate: TODAY, eta: addDays(TODAY, 5), leadTimeDays: 5, modal: 'air',
      status: 'ordered', hubId: 'osasco', source: 'test',
    };
    const base = purchaseForSku({ skuBase: 'X', skuName: 'X', forecast: forecast(2, 4), stock: stock(30), orders: [], policy: policy(), today: TODAY });
    const withPo = purchaseForSku({ skuBase: 'X', skuName: 'X', forecast: forecast(2, 4), stock: stock(30), orders: [order], policy: policy(), today: TODAY });
    expect(withPo.incomingUnits).toBe(50);
    expect(withPo.orderQty).toBe(base.orderQty - 50);
  });
});

describe('projectSku — projection walk', () => {
  const shares: Record<HubId, number> = { osasco: 1, mooca: 0, sbc: 0 };

  it('zero-demand SKUs never rupture', () => {
    const r = projectSku({ stock: stock(100), forecast: null, orders: [], policy: policy(), shares, today: TODAY });
    expect(r.global.stockoutDate).toBeNull();
    expect(r.global.currentStock).toBe(100);
  });

  it('constant demand depletes to a stockout', () => {
    const r = projectSku({ stock: stock(50), forecast: forecast(5, 5), orders: [], policy: policy(), shares, today: TODAY });
    expect(r.global.stockoutDate).toBe(addDays(TODAY, 10));
  });

  it('recovery offsets demand for repairable parts', () => {
    const r = projectSku({
      stock: stock(50),
      forecast: forecast(5, 5),
      orders: [],
      policy: policy({ recoveryRate: 1, recoveryTurnaroundDays: 5, isRepairable: true }),
      shares,
      today: TODAY,
    });
    expect(r.global.stockoutDate).toBeNull(); // recovery == demand after turnaround
  });

  it('an inbound PO pushes the stockout later', () => {
    const order: OpenPurchaseOrder = {
      id: 1, vo: '1', skuCode: 'X', skuBase: 'X', skuName: 'X', qty: 100,
      orderDate: TODAY, eta: addDays(TODAY, 10), leadTimeDays: 10, modal: 'sea',
      status: 'ordered', hubId: 'osasco', source: 'test',
    };
    const base = projectSku({ stock: stock(60), forecast: forecast(5, 5), orders: [], policy: policy(), shares, today: TODAY });
    const withPo = projectSku({ stock: stock(60), forecast: forecast(5, 5), orders: [order], policy: policy(), shares, today: TODAY });
    expect(base.global.stockoutDate).toBe(addDays(TODAY, 12)); // 60 / 5
    expect(withPo.global.incomingUnits).toBe(100);
    // +100 units / 5 per day = 20 extra days of cover
    expect(withPo.global.stockoutDate! > base.global.stockoutDate!).toBe(true);
    expect(withPo.global.stockoutDate).toBe(addDays(TODAY, 32));
  });
});

describe('transferForSku — hub-and-spoke', () => {
  const shares: Record<HubId, number> = { osasco: 0.2, mooca: 0.5, sbc: 0.3 };

  it('suggests Osasco→spoke moves sized to each shortfall', () => {
    const out = transferForSku({
      stock: stock(1010, { osasco: 1000, mooca: 5, sbc: 5 }),
      forecast: forecast(10, 12),
      shares,
      today: TODAY,
      asOfDate: TODAY,
    });
    const mooca = out.find((t) => t.toHub === 'mooca');
    const sbc = out.find((t) => t.toHub === 'sbc');
    expect(mooca?.fromHub).toBe('osasco');
    expect(mooca?.qty).toBe(35); // cover 8d × 5/day = 40 − 5 on hand
    expect(sbc?.qty).toBe(22); // cover 9d × 3/day = 27 − 5 on hand
  });

  it('emits nothing when Osasco has no surplus', () => {
    const out = transferForSku({
      stock: stock(10, { osasco: 0, mooca: 5, sbc: 5 }),
      forecast: forecast(10, 12),
      shares,
      today: TODAY,
      asOfDate: TODAY,
    });
    expect(out).toHaveLength(0);
  });
});
