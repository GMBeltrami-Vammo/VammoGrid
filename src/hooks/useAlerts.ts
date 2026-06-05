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

    // ── Tipo 4 — daily consumption spike ──────────────────────────────────
    // Fires when consumption on the most recent day AND the day before are both
    // greater than 1.5× the monthly average (L30D daily rate), per item × hub.
    const consumption_spike: Alert[] = [];

    // Map normalized IMS name → { skuId, skuName } so we can apply the global
    // filter (which is keyed by skuId) to Maestro consumption (keyed by name).
    const nameToSku = new Map<string, { skuId: string; skuName: string }>();
    for (const item of items) {
      const key = item.skuName.toLowerCase().trim();
      if (!nameToSku.has(key)) {
        nameToSku.set(key, { skuId: item.skuId, skuName: item.skuName });
      }
    }

    if (consumption.length > 0) {
      // Reference days: latest day present in the dataset, and the day before it
      const dayKey = (iso: string) => iso.slice(0, 10);
      let maxDay = '';
      for (const r of consumption) {
        const d = dayKey(r.day);
        if (d > maxDay) maxDay = d;
      }
      let prevDay = '';
      if (maxDay) {
        const d = new Date(maxDay + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        prevDay = d.toISOString().slice(0, 10);
      }

      // Aggregate today/yesterday qty per (itemGroup × hub)
      const spikeMap = new Map<
        string,
        { itemGroup: string; hubId: HubId; today: number; yest: number; avg: number }
      >();
      for (const r of consumption) {
        const key = `${r.itemGroup.toLowerCase().trim()}|${r.hubId}`;
        let e = spikeMap.get(key);
        if (!e) {
          e = { itemGroup: r.itemGroup, hubId: r.hubId, today: 0, yest: 0, avg: r.monthlyAvg };
          spikeMap.set(key, e);
        }
        e.avg = r.monthlyAvg; // constant across the item/hub records
        const d = dayKey(r.day);
        if (d === maxDay) e.today += r.qtyConsumed;
        else if (d === prevDay) e.yest += r.qtyConsumed;
      }

      for (const e of spikeMap.values()) {
        const threshold = SPIKE_MULTIPLIER * e.avg;
        if (e.avg > 0 && e.today > threshold && e.yest > threshold) {
          const mapped = nameToSku.get(e.itemGroup.toLowerCase().trim());
          const skuId = mapped?.skuId ?? e.itemGroup;
          if (excluded.has(skuId)) continue; // respect global filter
          consumption_spike.push({
            type: 'consumption_spike',
            skuId,
            skuName: mapped?.skuName ?? e.itemGroup,
            hubs: [e.hubId],
            today: e.today,
            yesterday: e.yest,
            avg: e.avg,
          });
        }
      }
    }

    // Sort each bucket: most urgent first
    doh_critical.sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));
    hub_zero.sort((a, b) => b.hubs.length - a.hubs.length);
    // Spikes: biggest jump over the average first
    consumption_spike.sort(
      (a, b) => (b.today ?? 0) / (b.avg || 1) - (a.today ?? 0) / (a.avg || 1),
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
