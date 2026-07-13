'use server';

import { updateTag } from 'next/cache';
import { requireHead } from '@/lib/auth/requireHead';
import { FLEET_TABLES, readFleetRow, readFleetTable, softDeleteFleetRow, upsertFleetRow } from '@/lib/clickhouse/fleet';
import type { Row } from '@/lib/clickhouse/reader';
import { addDays, diffDays } from '@/lib/planning/dates';

// Head-gated writes for the weekly fleet-size ledger (dev.fleet_size_weekly — review
// item 2). Every write goes through the shared audit-logging helper. Composite key
// (segment, week_start) → audit entityId `${segment}|${week_start}`.

function normDate(iso: string): string {
  return String(iso).slice(0, 10);
}

/** Register (or correct) the REAL fleet size of a segment for one week. */
export async function upsertWeeklySize(
  segment: string,
  weekStart: string,
  size: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const seg = segment.trim();
    const week = normDate(weekStart);
    if (!seg || !week) return { ok: false, error: 'Segmento e semana são obrigatórios.' };
    const current = await readFleetRow<Row>(FLEET_TABLES.fleetSizeWeekly, { segment: seg, week_start: week });
    await upsertFleetRow({
      table: FLEET_TABLES.fleetSizeWeekly,
      entityType: 'fleet_size_weekly',
      entityId: `${seg}|${week}`,
      current,
      next: { segment: seg, week_start: week, size: Math.max(0, Math.round(size)), updated_by: email },
      changedBy: email,
    });
    updateTag('fleet-size');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

export async function deleteWeeklySize(
  segment: string,
  weekStart: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const email = await requireHead();
    const week = normDate(weekStart);
    const current = await readFleetRow<Row>(FLEET_TABLES.fleetSizeWeekly, {
      segment: segment.trim(),
      week_start: week,
    });
    if (!current) return { ok: true };
    await softDeleteFleetRow({
      table: FLEET_TABLES.fleetSizeWeekly,
      entityType: 'fleet_size_weekly',
      entityId: `${segment.trim()}|${week}`,
      current,
      changedBy: email,
    });
    updateTag('fleet-size');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}

/**
 * End-of-month shortcut (review item 2, opção 1): given the segment's fleet size at a
 * month-end date, distribute the growth HOMOGENEOUSLY — linear interpolation from the
 * segment's latest known weekly record up to the informed date, writing one record per
 * 7 days. With no prior record, only the month-end week is written.
 */
export async function setMonthEndSize(
  segment: string,
  monthEndDate: string,
  size: number,
): Promise<{ ok: boolean; weeksWritten?: number; error?: string }> {
  try {
    const email = await requireHead();
    const seg = segment.trim();
    const end = normDate(monthEndDate);
    const endSize = Math.max(0, Math.round(size));
    if (!seg || !end) return { ok: false, error: 'Segmento e data são obrigatórios.' };

    // Latest known record BEFORE the informed date (interpolation anchor).
    const all = await readFleetTable<Row>(FLEET_TABLES.fleetSizeWeekly);
    const prior = all
      .filter((r) => r.segment === seg && String(r.week_start).slice(0, 10) < end)
      .sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)))
      .pop();

    // Week dates: the informed date and every -7d step back to (exclusive) the anchor.
    const weeks: string[] = [];
    for (let d = end; !prior || d > String(prior.week_start).slice(0, 10); d = addDays(d, -7)) {
      weeks.unshift(d);
      if (!prior && weeks.length >= 1) break; // no anchor → only the month-end week
      if (weeks.length > 10) break; // safety: never generate more than ~2 months back
    }

    const anchorDate = prior ? String(prior.week_start).slice(0, 10) : end;
    const anchorSize = prior ? Number(prior.size) || 0 : endSize;
    const span = Math.max(1, diffDays(anchorDate, end));

    let written = 0;
    for (const week of weeks) {
      const frac = Math.min(1, Math.max(0, diffDays(anchorDate, week) / span));
      const value = Math.round(anchorSize + (endSize - anchorSize) * frac);
      const current = await readFleetRow<Row>(FLEET_TABLES.fleetSizeWeekly, { segment: seg, week_start: week });
      await upsertFleetRow({
        table: FLEET_TABLES.fleetSizeWeekly,
        entityType: 'fleet_size_weekly',
        entityId: `${seg}|${week}`,
        current,
        next: { segment: seg, week_start: week, size: value, updated_by: email },
        changedBy: email,
      });
      written++;
    }
    updateTag('fleet-size');
    return { ok: true, weeksWritten: written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro desconhecido' };
  }
}
