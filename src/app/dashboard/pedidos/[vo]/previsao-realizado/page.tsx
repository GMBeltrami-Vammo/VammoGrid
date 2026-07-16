import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { fetchOrderRows } from '@/lib/planning/source/orders';
import { mapPurchaseOrderRow } from '@/lib/clickhouse/mappers';
import { fetchForecastAsOf } from '@/lib/planning/source/forecast';
import { fetchDailyConsumption } from '@/lib/planning/source/consumption';
import { fetchStockHistory } from '@/lib/planning/source/history';
import { buildPrevReal } from '@/lib/planning/prevReal';
import { diffDays, todayUtc } from '@/lib/planning/dates';
import { EmptyState, PageHeader } from '@/components/planning/ui';
import { PrevRealView, type PrevRealSku } from '@/components/planning/PrevRealView';
import { fmtDate } from '@/lib/planning/format';
import type { PurchaseOrder } from '@/types';

export const dynamic = 'force-dynamic';

interface LineSnapshot {
  forecastAsOf?: string;
}

// Previsão × Realizado (review 8 fase 2): using the pedido's FROZEN forecastAsOf, overlay
// the demand forecast vs realized consumption and the projected vs realized stock, per SKU.
export default async function PrevRealPage({ params }: { params: Promise<{ vo: string }> }) {
  const { vo: raw } = await params;
  const key = decodeURIComponent(raw);
  const today = todayUtc();

  const rows = await fetchOrderRows();
  const orders: PurchaseOrder[] = rows.map(mapPurchaseOrderRow);
  const group = orders.filter((o) => (o.vo ? o.vo === key : o.id === key));

  const back = (
    <Link
      href={`/dashboard/pedidos/${encodeURIComponent(key)}`}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={14} /> Voltar ao pedido
    </Link>
  );

  if (group.length === 0) {
    return (
      <div>
        {back}
        <PageHeader eyebrow="Previsão × Realizado" title={key} />
        <EmptyState title="Pedido não encontrado" />
      </div>
    );
  }

  // The frozen forecast as-of, from the first line that carries a snapshot.
  let forecastAsOf: string | null = null;
  for (const o of group) {
    if (!o.elaborationSnapshot) continue;
    try {
      const s = JSON.parse(o.elaborationSnapshot) as LineSnapshot;
      if (s.forecastAsOf) {
        forecastAsOf = s.forecastAsOf.slice(0, 10);
        break;
      }
    } catch {
      /* ignore malformed */
    }
  }

  if (!forecastAsOf) {
    return (
      <div>
        {back}
        <PageHeader
          eyebrow="Previsão × Realizado"
          title={group[0].pedidoName ?? group[0].vo ?? key}
        />
        <EmptyState
          title="Sem base de elaboração congelada"
          hint="Só pedidos criados pelo Novo Pedido (com a previsão congelada) podem ser comparados com o realizado."
        />
      </div>
    );
  }

  // Comparison window (Notas P4): the pedido's lifecycle [emissão → ETA]. Realized fills
  // up to today; the rest is the still-to-happen projection.
  const orderDates = group.map((o) => o.orderDate).filter(Boolean).sort() as string[];
  const etas = group.map((o) => o.eta).filter(Boolean).sort() as string[];
  const windowStart = (orderDates[0] ?? forecastAsOf).slice(0, 10);
  const etaEnd = (etas.length ? etas[etas.length - 1] : today).slice(0, 10);
  const windowEnd = etaEnd < windowStart ? windowStart : etaEnd;
  const totalDays = diffDays(windowStart, windowEnd) + 1;
  const elapsedDays = Math.max(0, Math.min(diffDays(windowStart, today) + 1, totalDays));
  // History/consumption must reach back to the earlier of the window start and the forecast
  // origin so the stock series can anchor on a realized on-hand within the window.
  const dataStart = windowStart < forecastAsOf ? windowStart : forecastAsOf;

  // Unique SKUs in the pedido.
  const skuBases = [...new Set(group.map((o) => o.sku))];
  const nameBySku = new Map(group.map((o) => [o.sku, o.skuName]));

  const skus: PrevRealSku[] = await Promise.all(
    skuBases.map(async (skuBase): Promise<PrevRealSku> => {
      const [forecast, consumption, history] = await Promise.all([
        fetchForecastAsOf(skuBase, forecastAsOf!),
        fetchDailyConsumption(skuBase, dataStart, today),
        fetchStockHistory(skuBase, { osasco: 0, mooca: 0, sbc: 0 }, Math.max(30, diffInclusive(dataStart, today))),
      ]);
      const series = buildPrevReal({
        forecastPoints: (forecast?.points ?? []).map((p) => ({ date: p.date, yhat: p.yhat })),
        consumption,
        history: history.global,
        asOfDate: forecastAsOf!,
        today,
        windowStart,
        windowEnd,
      });
      return { skuBase, skuName: nameBySku.get(skuBase) ?? null, ...series };
    }),
  );

  return (
    <div>
      {back}
      <PageHeader
        eyebrow="Previsão × Realizado"
        title={group[0].pedidoName ?? group[0].vo ?? key}
        subtitle={`Base congelada em ${fmtDate(forecastAsOf)}. Janela do pedido ${fmtDate(windowStart)} (emissão) → ${fmtDate(windowEnd)} (ETA) · ${elapsedDays} de ${totalDays} dias decorridos.`}
      />
      <PrevRealView skus={skus} />
    </div>
  );
}

function diffInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 2);
}
