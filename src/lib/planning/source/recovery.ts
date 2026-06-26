import 'server-only';
import type { HistoricalRecovery } from '@/types/planning';
import { cachedChQuery } from '@/lib/clickhouse/reader';
import { toSkuBase } from '../sku';

// Historical recovery rate per SKU from the IMS ledger.
// Aggregates RECONDITION events vs USAGE_* events over the last 90 days.
// Rate = recovered / consumed; if a SKU has no usage in the window it is omitted.

const LOOKBACK_DAYS = 90;

interface RecoveryRow {
  sku_code: string;
  recovered: number | string;
  consumed: number | string;
}

const RECOVERY_SQL = `
SELECT it.item_code AS sku_code,
       sumIf(abs(toFloat64(led.delta)), led.ledger_type = 'RECONDITION') AS recovered,
       sumIf(abs(toFloat64(led.delta)), led.ledger_type LIKE 'USAGE%')   AS consumed
FROM analytics.stg_ims_r__ledger led
JOIN analytics.stg_ims_r__inventory inv ON inv.inventory_id = led.inventory_id
JOIN analytics.stg_ims_r__item it ON it.item_id = inv.item_id
WHERE (led.ledger_type = 'RECONDITION' OR led.ledger_type LIKE 'USAGE%')
  AND led.created_at >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
GROUP BY sku_code
HAVING consumed > 0`;

export async function fetchRecoveryRates(): Promise<Map<string, HistoricalRecovery>> {
  let rows: RecoveryRow[] = [];
  try {
    // 90-day observed window → cache 1h across requests.
    rows = await cachedChQuery<RecoveryRow>(RECOVERY_SQL, 3600, ['recovery-rates']);
  } catch {
    return new Map();
  }

  const byBase = new Map<string, { recovered: number; consumed: number }>();
  for (const r of rows) {
    const skuBase = toSkuBase(String(r.sku_code));
    const rec = Number(r.recovered) || 0;
    const con = Number(r.consumed) || 0;
    const existing = byBase.get(skuBase);
    if (existing) {
      existing.recovered += rec;
      existing.consumed += con;
    } else {
      byBase.set(skuBase, { recovered: rec, consumed: con });
    }
  }

  const result = new Map<string, HistoricalRecovery>();
  for (const [skuBase, { recovered, consumed }] of byBase) {
    if (consumed <= 0) continue;
    result.set(skuBase, {
      rate: recovered / consumed,
      recovered,
      consumed,
      lookbackDays: LOOKBACK_DAYS,
    });
  }
  return result;
}
