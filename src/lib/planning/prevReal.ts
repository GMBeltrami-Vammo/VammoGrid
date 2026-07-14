import { addDays, diffDays } from './dates';

// Assemble the "previsão × realizado" series (review 8 fase 2). Pure — no data access,
// so it's unit-testable. Given the FROZEN forecast (as_of), realized daily consumption,
// and realized on-hand history, produce two aligned daily series over [asOf, today]:
//   • demand: previsto (yhat) × realizado (consumo)
//   • estoque: projetado (on-hand@asOf − Σ previsto, floored) × realizado (on-hand)

export interface PrevRealPoint {
  date: string;
  prev: number | null;
  real: number | null;
}

export interface PrevRealSeries {
  demand: PrevRealPoint[];
  stock: PrevRealPoint[];
  /** Σ realizado ÷ Σ previsto over the elapsed days where a forecast exists (null if none). */
  demandRatio: number | null;
}

function dateRange(from: string, to: string): string[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export function buildPrevReal(args: {
  forecastPoints: { date: string; yhat: number }[];
  consumption: { date: string; qty: number }[];
  history: { date: string; stock: number }[];
  asOfDate: string;
  today: string;
}): PrevRealSeries {
  const asOf = args.asOfDate.slice(0, 10);
  const today = args.today.slice(0, 10);
  const yhatByDate = new Map(args.forecastPoints.map((p) => [p.date.slice(0, 10), p.yhat]));
  const usedByDate = new Map(args.consumption.map((p) => [p.date.slice(0, 10), p.qty]));
  const stockByDate = new Map(args.history.map((p) => [p.date.slice(0, 10), p.stock]));

  const dates = dateRange(asOf, today);

  // Demand: prev = yhat (null when the run has no point that day); real = consumed that
  // day (0 when no ledger row — a real zero-usage day).
  const demand: PrevRealPoint[] = dates.map((date) => ({
    date,
    prev: yhatByDate.has(date) ? yhatByDate.get(date)! : null,
    real: usedByDate.get(date) ?? 0,
  }));

  // Stock: anchor the projection on the realized on-hand at (or just after) as_of, then
  // subtract cumulative forecast demand, floored at 0 (lost-sales, as the engine does).
  const anchorDate = dates.find((d) => stockByDate.has(d));
  const stock: PrevRealPoint[] = [];
  if (anchorDate) {
    let proj = stockByDate.get(anchorDate)!;
    for (const date of dates) {
      if (date >= anchorDate) {
        proj = Math.max(0, proj - (yhatByDate.get(date) ?? 0));
      }
      stock.push({
        date,
        prev: date >= anchorDate ? Math.round(proj) : null,
        real: stockByDate.has(date) ? Math.round(stockByDate.get(date)!) : null,
      });
    }
  }

  // Accuracy over elapsed days (up to today) where a forecast exists.
  let sumPrev = 0;
  let sumReal = 0;
  for (const p of demand) {
    if (p.date > today) break;
    if (p.prev == null) continue;
    sumPrev += p.prev;
    sumReal += p.real ?? 0;
  }
  const demandRatio = sumPrev > 0 ? sumReal / sumPrev : null;

  return { demand, stock, demandRatio };
}
