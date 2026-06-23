import 'server-only';
import type { HubId } from '@/types/planning';
import { HUB_BY_LOCATION, HUB_LOCATION_IDS } from '@/constants/planningHubs';
import { chQuery } from '@/lib/clickhouse/reader';
import { toSkuBase } from '../sku';

// Per-hub demand allocation key: each SKU's trailing-30d consumption share by hub,
// from the IMS ledger USAGE_* deltas. Used to split fleet-level forecast demand
// across hubs. When a SKU has no recent usage it is absent here and the projection
// falls back to the on-hand distribution (see allocation.resolveShares).

interface ShareRow {
  sku_code: string;
  location_id: number | string;
  used: number | string;
}

const SHARES_SQL = `
SELECT it.item_code AS sku_code,
       loc.location_id AS location_id,
       sum(abs(toFloat64(led.delta))) AS used
FROM analytics.stg_ims_r__ledger led
JOIN analytics.stg_ims_r__inventory inv ON inv.inventory_id = led.inventory_id
JOIN analytics.stg_ims_r__deposit dep ON dep.deposit_id = inv.deposit_id
JOIN analytics.stg_ims_r__location loc ON loc.location_id = dep.location_id
JOIN analytics.stg_ims_r__item it ON it.item_id = inv.item_id
WHERE led.ledger_type LIKE 'USAGE%'
  AND led.created_at >= now() - INTERVAL 30 DAY
  AND loc.location_id IN (${HUB_LOCATION_IDS})
GROUP BY sku_code, location_id`;

export async function fetchHubShares(): Promise<Map<string, Record<HubId, number>>> {
  let rows: ShareRow[] = [];
  try {
    rows = await chQuery<ShareRow>(SHARES_SQL);
  } catch {
    return new Map(); // ledger query unavailable → callers fall back to on-hand share
  }

  const used = new Map<string, Record<HubId, number>>();
  for (const r of rows) {
    const skuBase = toSkuBase(String(r.sku_code));
    const hub = HUB_BY_LOCATION[Number(r.location_id)];
    if (!hub) continue;
    let m = used.get(skuBase);
    if (!m) {
      m = { osasco: 0, mooca: 0, sbc: 0 };
      used.set(skuBase, m);
    }
    m[hub] += Number(r.used) || 0;
  }

  const shares = new Map<string, Record<HubId, number>>();
  for (const [sku, m] of used) {
    const total = m.osasco + m.mooca + m.sbc;
    if (total <= 0) continue;
    shares.set(sku, { osasco: m.osasco / total, mooca: m.mooca / total, sbc: m.sbc / total });
  }
  return shares;
}
