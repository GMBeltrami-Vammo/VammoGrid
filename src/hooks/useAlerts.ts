'use client';

import { useMemo } from 'react';
import { useInventory } from './useInventory';
import { useConsumption } from './useConsumption';
import { useSkuFilter } from '@/lib/filter/FilterContext';
import type { Alert, HubId, InventoryItem } from '@/types';

const DOH_CRITICAL_ALERT = 3; // Tipo 1: DOH < 3
const SPIKE_MULTIPLIER = 2; // Tipo 4: a day's consumption > 2× the L30D daily avg
const SPIKE_MIN_QTY = 5; // Tipo 4: ...and at least this many units that day (cuts low-volume noise)

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

    // ── Tipo 4 — high-consumption days ────────────────────────────────────
    // One alert per DAY where an item/hub consumed > 1.5× its L30D daily average
    // AND at least SPIKE_MIN_QTY units (cuts low-volume noise). No 7-day cap —
    // every qualifying day is its own alert, labelled with weekday + date.
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
    // Current stock per (skuId|hubId) for the "estoque atual" field.
    const stockByKey = new Map<string, number>();
    for (const item of items) {
      const key = item.skuName.toLowerCase().trim();
      if (!nameToSku.has(key)) {
        nameToSku.set(key, { skuId: item.skuId, skuName: item.skuName });
      }
      stockByKey.set(`${item.skuId}|${item.hubId}`, item.qtyAvailable);
    }

    for (const r of consumption) {
      const avg = r.monthlyAvg; // L30D daily rate
      if (avg <= 0) continue;
      if (r.qtyConsumed < SPIKE_MIN_QTY) continue;
      if (r.qtyConsumed <= SPIKE_MULTIPLIER * avg) continue;

      const mapped = nameToSku.get(r.itemGroup.toLowerCase().trim());
      const skuId = mapped?.skuId ?? r.itemGroup;
      if (excluded.has(skuId)) continue; // respect global filter

      const isoDay = r.day.slice(0, 10);
      const d = new Date(isoDay + 'T12:00:00Z');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');

      consumption_spike.push({
        type: 'consumption_spike',
        skuId,
        skuName: mapped?.skuName ?? r.itemGroup,
        hubs: [r.hubId],
        dayLabel: `${WEEKDAYS_PT[d.getUTCDay()]} - ${dd}/${mm}`,
        daySort: isoDay,
        dayQty: r.qtyConsumed,
        currentStock: stockByKey.get(`${skuId}|${r.hubId}`) ?? 0,
        monthlyConsumption: Math.round(avg * 30),
        avg,
      });
    }

    // Sort each bucket: most urgent first
    doh_critical.sort((a, b) => (a.doh ?? 0) - (b.doh ?? 0));
    hub_zero.sort((a, b) => b.hubs.length - a.hubs.length);
    // Spikes: most recent day first, then biggest quantity
    consumption_spike.sort((a, b) => {
      const byDay = (b.daySort ?? '').localeCompare(a.daySort ?? '');
      if (byDay !== 0) return byDay;
      return (b.dayQty ?? 0) - (a.dayQty ?? 0);
    });

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
