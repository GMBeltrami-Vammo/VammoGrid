import { describe, expect, it } from 'vitest';
import { applySupplierLeadTimes, type SupplierLead } from './policy';
import type { SkuPolicy } from '@/types/planning';

// Lead time now lives on the supplier — applySupplierLeadTimes overrides each SKU's
// lead from its preferred supplier, with the SKU's own lead as the fallback.

function policy(over: Partial<SkuPolicy> = {}): SkuPolicy {
  return {
    skuBase: 'X',
    leadTimeDays: 110,
    leadTimeSource: 'international-default',
    leadTimeSeaDays: 110,
    leadTimeAirDays: 40,
    defaultModal: 'sea',
    leadTimeStdDays: null,
    abcClass: 'C',
    targetDoi: 30,
    recoveryRate: 0,
    recoveryTurnaroundDays: 14,
    safetyOverride: null,
    isRepairable: false,
    updatedBy: null,
    updatedAt: '2026-01-01',
    ...over,
  };
}

describe('applySupplierLeadTimes', () => {
  it("overrides sea/air + effective lead from the SKU's preferred supplier", () => {
    const policies = new Map([['A', policy({ skuBase: 'A' })]]);
    const lead = new Map<string, SupplierLead>([['A', { kind: 'internacional', sea: 105, air: 45 }]]);
    const out = applySupplierLeadTimes(policies, lead).get('A')!;
    expect(out.leadTimeSeaDays).toBe(105);
    expect(out.leadTimeAirDays).toBe(45);
    expect(out.leadTimeDays).toBe(105); // defaultModal sea → effective = sea
    expect(out.leadTimeSource).toBe('international-default');
  });

  it('effective lead follows the default modal', () => {
    const policies = new Map([['A', policy({ skuBase: 'A', defaultModal: 'air' })]]);
    const lead = new Map<string, SupplierLead>([['A', { kind: 'internacional', sea: 105, air: 45 }]]);
    expect(applySupplierLeadTimes(policies, lead).get('A')!.leadTimeDays).toBe(45);
  });

  it('national supplier sets the leadTimeSource to national-file', () => {
    const policies = new Map([['A', policy({ skuBase: 'A' })]]);
    const lead = new Map<string, SupplierLead>([['A', { kind: 'nacional', sea: 20, air: 10 }]]);
    expect(applySupplierLeadTimes(policies, lead).get('A')!.leadTimeSource).toBe('national-file');
  });

  it('keeps the SKU lead when it has no supplier', () => {
    const policies = new Map([['A', policy({ skuBase: 'A', leadTimeSeaDays: 60, leadTimeDays: 60 })]]);
    const out = applySupplierLeadTimes(policies, new Map()).get('A')!;
    expect(out.leadTimeSeaDays).toBe(60);
    expect(out.leadTimeDays).toBe(60);
  });

  it('keeps the SKU lead when the supplier has no lead set', () => {
    const policies = new Map([['A', policy({ skuBase: 'A', leadTimeSeaDays: 60, leadTimeDays: 60 })]]);
    const lead = new Map<string, SupplierLead>([['A', { kind: 'internacional', sea: null, air: null }]]);
    expect(applySupplierLeadTimes(policies, lead).get('A')!.leadTimeSeaDays).toBe(60);
  });

  it('falls back per-modal: supplier air only keeps the SKU sea', () => {
    const policies = new Map([['A', policy({ skuBase: 'A', leadTimeSeaDays: 110, leadTimeAirDays: 40 })]]);
    const lead = new Map<string, SupplierLead>([['A', { kind: 'internacional', sea: null, air: 30 }]]);
    const out = applySupplierLeadTimes(policies, lead).get('A')!;
    expect(out.leadTimeSeaDays).toBe(110); // kept
    expect(out.leadTimeAirDays).toBe(30); // overridden
  });
});
