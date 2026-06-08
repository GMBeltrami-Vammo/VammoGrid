'use client';

import { useMemo } from 'react';
import { useInventory } from './useInventory';
import { useConsumption } from './useConsumption';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import type { Alert, HubId, InventoryItem } from '@/types';

const DOH_CRITICAL_ALERT = 3; // Tipo 1: DOH < 3
const SPIKE_MULTIPLIER = 1.5; // Tipo 4: day & prior day both > 1.5× monthly avg

interface AlertsResult {
  alerts: Alert[];
  byType: {
    doh_critical: Alert[];
    hub_zero: Alert[];
    total_zero: Alert[];
    consumption_spike: Alert[];
  };
  total: number;
  isLoading: boolean;
  isError: boolean;
}

export function useAlerts(): AlertsResult {
  const { data: items = [], isLoading, isError } = useInventory();
  const { data: consumption = [] } = useConsumption();
  const { excluded } = useSkuFilter();

  return useMemo(() => {
    // Respect the global filter — excluded SKUs raise no alerts
    const visible = items.filter((i) => !excluded.has(i.skuId));

    // Group items (SKU × hub) by skuId
    const bySku = new Map<string, InventoryItem[]>();
    for (const item of visible) {
      const list = bySku.get(item.skuId);
      if (list) list.push(item);
      else bySku.set(item.skuId, [item]);
    }

    const doh_critical: Alert[] = [];
    const hub_zero: Alert[] = [];
    const total_zero: Alert[] = [];

    for (const [skuId, group] of bySku) {
      const skuName = group[0]?.skuName ?? skuId;

      // Tipo 1 — DOH < 3 in any hub
      const criticalHubs = group
        .filter((g) => g.doh !== null && g.doh < DOH_CRITICAL_ALERT)
        .sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));
      if (criticalHubs.length > 0) {
        doh_critical.push({
          type: 'doh_critical',
          skuId,
          skuName,
          hubs: criticalHubs.map((g) => g.hubId),
          doh: criticalHubs[0].doh,
        });
      }

      // Tipo 2 — stock = 0 in at least one hub
      const zeroHubs = group.filter((g) => g.qtyAvailable === 0).map((g) => g.hubId);
      if (zeroHubs.length > 0) {
        hub_zero.push({ type: 'hub_zero', skuId, skuName, hubs: zeroHubs as HubId[] });
      }

      // Tipo 3 — total stock across all hubs = 0
      // NOTE: Metabase #29571 filters out qty_total = 0 at the source, so this
      // currently never fires. Kept for when zero-total SKUs are included.
      const total = group.reduce((sum, g) => sum + g.qtyAvailable, 0);
      if (total === 0) {
        total_zero.push({
          type: 'total_zero',
          skuId,
          skuName,
          hubs: group.map((g) => g.hubId),
        });
      }
    }

    // ── Tipo 4 — high consumption by weekday ──────────────────────────────
    // For each item × hub, flag the weekdays on which consumption exceeded
    // 1.5× the L30D daily average. Up to 7 alerts per item/hub (one per weekday).
    const consumption_spike: Alert[] = [];
    const WEEKDAYS_PT = [
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ];

    // Map normalized IMS name → { skuId, skuName } so we can apply the global
    // filter (keyed by skuId) to Maestro consumption (keyed by name).
    const nameToSku = new Map<string, { skuId: string; skuName: string }>();
    for (const item of items) {
      const key = item.skuName.toLowerCase().trim();
      if (!nameToSku.has(key)) {
        nameToSku.set(key, { skuId: item.skuId, skuName: item.skuName });
      }
    }

    if (consumption.length > 0) {
      // Group all daily records per (itemGroup × hub)
      const groups = new Map<
        string,
        {
          itemGroup: string;
          hubId: HubId;
          avg: number;
          recs: { day: string; qty: number }[];
        }
      >();
      for (const r of consumption) {
        const key = `${r.itemGroup.toLowerCase().trim()}|${r.hubId}`;
        let g = groups.get(key);
        if (!g) {
          g = { itemGroup: r.itemGroup, hubId: r.hubId, avg: r.monthlyAvg, recs: [] };
          groups.set(key, g);
        }
        g.avg = r.monthlyAvg; // constant across the item/hub records
        g.recs.push({ day: r.day.slice(0, 10), qty: r.qtyConsumed });
      }

      for (const g of groups.values()) {
        if (g.avg <= 0) continue;
        const threshold = SPIKE_MULTIPLIER * g.avg;

        // Per weekday, keep the peak consumption among days above the threshold
        const peakByWeekday = new Map<number, number>();
        for (const rec of g.recs) {
          if (rec.qty > threshold) {
            const wd = new Date(rec.day + 'T12:00:00Z').getUTCDay();
            peakByWeekday.set(wd, Math.max(peakByWeekday.get(wd) ?? 0, rec.qty));
          }
        }
        if (peakByWeekday.size === 0) continue;

        const mapped = nameToSku.get(g.itemGroup.toLowerCase().trim());
        const skuId = mapped?.skuId ?? g.itemGroup;
        if (excluded.has(skuId)) continue; // respect global filter

        // One alert per flagged weekday (≤ 7), strongest first
        const ordered = [...peakByWeekday.entries()].sort((a, b) => b[1] - a[1]);
        for (const [wd, qty] of ordered) {
          consumption_spike.push({
            type: 'consumption_spike',
            skuId,
            skuName: mapped?.skuName ?? g.itemGroup,
            hubs: [g.hubId],
            weekday: WEEKDAYS_PT[wd],
            weekdayQty: qty,
            avg: g.avg,
          });
        }
      }
    }

    // Sort each bucket: most urgent first
    doh_critical.sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));
    hub_zero.sort((a, b) => b.hubs.length - a.hubs.length);
    // Spikes: biggest jump over the average first
    consumption_spike.sort(
      (a, b) =>
        (b.weekdayQty ?? 0) / (b.avg || 1) - (a.weekdayQty ?? 0) / (a.avg || 1),
    );

    const alerts = [
      ...total_zero,
      ...doh_critical,
      ...consumption_spike,
      ...hub_zero,
    ];

    return {
      alerts,
      byType: { doh_critical, hub_zero, total_zero, consumption_spike },
      total: alerts.length,
      isLoading,
      isError,
    };
  }, [items, consumption, excluded, isLoading, isError]);
}
