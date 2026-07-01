import { describe, expect, it } from 'vitest';
import type {
  HubId,
  OpenPurchaseOrder,
  PurchaseSuggestion,
  SkuForecast,
  SkuPolicy,
  StockState,
} from '@/types/planning';
import { addDays } from './dates';
import { scaleForecast, delayOrder } from './scenario';
import { computeHubRisk, delayedShipments, supplyMix } from './selectors';

const TODAY = '2026-06-24';

function fc(yhat: number, days = 150): SkuForecast {
  return {
    skuBase: 'X',
    asOfDate: TODAY,
    abcClass: 'C',
    modelVersion: 't',
    horizonDays: days,
    points: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      date: addDays(TODAY, i + 1),
      yhat,
      lo: yhat,
      hi: yhat,
    })),
  };
}

function stock(byHub: Partial<Record<HubId, number>>, skuBase = 'X'): StockState {
  const h = { osasco: 0, mooca: 0, sbc: 0, ...byHub } as Record<HubId, number>;
  return {
    skuBase,
    skuName: skuBase,
    byHub: h,
    total: h.osasco + h.mooca + h.sbc,
    unitPrice: 10,
    isRepairable: false,
    category: null,
    lastUpdated: TODAY,
  };
}

describe('scenario levers', () => {
  it('scales forecast demand by a percentage', () => {
    expect(scaleForecast(fc(10), 20).points[0].yhat).toBeCloseTo(12);
    expect(scaleForecast(fc(10), 0).points[0].yhat).toBe(10);
  });
  it('delays an order ETA by N days', () => {
    const o: OpenPurchaseOrder = {
      id: '1', vo: null, skuCode: 'X', skuBase: 'X', skuName: 'X', qty: 10,
      orderDate: TODAY, eta: addDays(TODAY, 10), leadTimeDays: 10, modal: 'sea',
      status: 'ordered', hubId: 'osasco', source: 't',
    };
    expect(delayOrder(o, 5).eta).toBe(addDays(TODAY, 15));
  });
});

describe('computeHubRisk', () => {
  it('flags low-cover hubs and ranks most-at-risk first', () => {
    const stocks = [stock({ osasco: 100, mooca: 2 })];
    const forecasts = new Map([['X', fc(1)]]); // fleet 1/day
    const sharesFor = () => ({ osasco: 0.5, mooca: 0.5, sbc: 0 }) as Record<HubId, number>;
    const risk = computeHubRisk({ stocks, forecasts, sharesFor, riskDays: 14 });
    expect(risk.find((r) => r.hub === 'mooca')!.atRisk).toBe(1); // 2 / 0.5 = 4d cover
    expect(risk.find((r) => r.hub === 'osasco')!.atRisk).toBe(0); // 100 / 0.5 = 200d
    expect(risk[0].hub).toBe('mooca');
  });
});

describe('delayedShipments', () => {
  it('returns only overdue open POs with days-late', () => {
    const orders: OpenPurchaseOrder[] = [
      { id: '1', vo: 'A', skuCode: 'X', skuBase: 'X', skuName: 'X', qty: 50, orderDate: '2026-01-01', eta: addDays(TODAY, -5), leadTimeDays: 10, modal: 'sea', status: 'ordered', hubId: 'osasco', source: 't' },
      { id: '2', vo: 'B', skuCode: 'Y', skuBase: 'Y', skuName: 'Y', qty: 50, orderDate: '2026-01-01', eta: addDays(TODAY, 10), leadTimeDays: 10, modal: 'sea', status: 'ordered', hubId: 'osasco', source: 't' },
    ];
    const purchases = new Map<string, PurchaseSuggestion>([
      ['X', { skuBase: 'X', status: 'CRITICAL' } as PurchaseSuggestion],
    ]);
    const out = delayedShipments(orders, purchases, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].order.id).toBe('1');
    expect(out[0].daysLate).toBe(5);
  });
});

describe('supplyMix', () => {
  it('sums procurement (incoming) and recovery (rate × horizon demand)', () => {
    const purchases = [{ incomingUnits: 100 } as PurchaseSuggestion];
    const forecasts = new Map([['X', fc(2, 150)]]); // 2/day × 150 = 300
    const policies = new Map<string, SkuPolicy>([
      ['X', { skuBase: 'X', isRepairable: true, recoveryRate: 0.5, leadTimeDays: 110, leadTimeSource: 'international-default', leadTimeSeaDays: 110, leadTimeAirDays: 40, defaultModal: 'sea', abcClass: 'C', targetDoi: 60, recoveryTurnaroundDays: 14, safetyOverride: null, updatedBy: null, updatedAt: TODAY }],
    ]);
    const mix = supplyMix({ purchases, forecasts, policies, horizon: 150 });
    expect(mix.procurement).toBe(100);
    expect(mix.recovery).toBe(150); // 0.5 × 300
  });
});
