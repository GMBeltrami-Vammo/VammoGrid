// UTC day-granularity date helpers shared by the planning engines. Engines take an
// explicit `today` (YYYY-MM-DD) so projections are deterministic and testable.

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Today (UTC) as YYYY-MM-DD. Pass the result into engines so a single clock read
 *  flows through the whole computation. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
