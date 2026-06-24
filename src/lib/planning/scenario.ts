import type { OpenPurchaseOrder, SkuForecast } from '@/types/planning';
import { addDays } from './dates';

// Portfolio-wide what-if, persisted in the `vg:scenario` cookie and applied in
// loadPlanningInputs BEFORE the engines run. It is a pure recompute — it never
// writes production data. Two levers:
//   • demandPct   — scale all forecast demand by ±%
//   • poDelayDays — push every open PO's ETA out by N days
// Lets the planner answer "what if demand +20%?" / "what if a shipment slips 30d?"
// across the whole platform.

export interface PlanningScenario {
  demandPct: number;
  poDelayDays: number;
}

export const SCENARIO_COOKIE = 'vg:scenario';
export const EMPTY_SCENARIO: PlanningScenario = { demandPct: 0, poDelayDays: 0 };

export function parseScenarioCookie(raw: string | undefined): PlanningScenario {
  if (!raw) return EMPTY_SCENARIO;
  let txt = raw;
  try {
    txt = decodeURIComponent(raw);
  } catch {
    /* not encoded */
  }
  try {
    const o = JSON.parse(txt) as Partial<PlanningScenario>;
    return {
      demandPct: Number.isFinite(o.demandPct) ? Number(o.demandPct) : 0,
      poDelayDays: Number.isFinite(o.poDelayDays) ? Number(o.poDelayDays) : 0,
    };
  } catch {
    return EMPTY_SCENARIO;
  }
}

export function isScenarioActive(s: PlanningScenario): boolean {
  return s.demandPct !== 0 || s.poDelayDays !== 0;
}

export function scaleForecast(fc: SkuForecast, demandPct: number): SkuForecast {
  if (demandPct === 0) return fc;
  const f = 1 + demandPct / 100;
  return {
    ...fc,
    points: fc.points.map((p) => ({ ...p, yhat: p.yhat * f, lo: p.lo * f, hi: p.hi * f })),
  };
}

export function delayOrder(o: OpenPurchaseOrder, days: number): OpenPurchaseOrder {
  if (days === 0 || !o.eta) return o;
  return {
    ...o,
    eta: addDays(o.eta, days),
    leadTimeDays: o.leadTimeDays != null ? o.leadTimeDays + days : null,
  };
}
