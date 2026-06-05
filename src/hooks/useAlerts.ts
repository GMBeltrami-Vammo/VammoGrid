'use client';

import { useMemo } from 'react';
import { useInventory } from './useInventory';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import type { Alert, HubId, InventoryItem } from '@/types';

const DOH_CRITICAL_ALERT = 3; // Tipo 1: DOH < 3

interface AlertsResult {
  alerts: Alert[];
  byType: {
    doh_critical: Alert[];
    hub_zero: Alert[];
    total_zero: Alert[];
  };
  total: number;
  isLoading: boolean;
  isError: boolean;
}

export function useAlerts(): AlertsResult {
  const { data: items = [], isLoading, isError } = useInventory();
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

    // Sort each bucket: most urgent first
    doh_critical.sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));
    hub_zero.sort((a, b) => b.hubs.length - a.hubs.length);

    const alerts = [...total_zero, ...doh_critical, ...hub_zero];

    return {
      alerts,
      byType: { doh_critical, hub_zero, total_zero },
      total: alerts.length,
      isLoading,
      isError,
    };
  }, [items, excluded, isLoading, isError]);
}
