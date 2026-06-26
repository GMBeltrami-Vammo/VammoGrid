import type {
  OpenPurchaseOrder,
  PurchaseStatus,
  PurchaseSuggestion,
  RiskLevel,
  SkuForecast,
  SkuPolicy,
  StockState,
} from '@/types/planning';
import { ABC_Z, BAND_Z, HORIZON_DAYS } from './constants';
import { addDays, diffDays } from './dates';
import { buildDailyDemand, cumsum } from './forecast';

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Recommendation Engine
//
// Deterministic (s,S) inventory policy, ported from the forecast-lab
// (build_purchase_plan.py + the order-plan tab). Per SKU, with lead time L:
//
//   estoque_mínimo = Σ yhat over L            (consumption integrated over the lead time)
//   σ_mês          = √(Σ_{d=1..30} σ_d²)       (σ of the next 30d, σ_d = (hi−yhat)/1.28)
//   σ_L            = σ_mês × √(L / 30)         (scaled to the lead time, in months)
//   safety         = ABC_Z[class] × σ_L        (or a per-SKU override)
//   ROP            = estoque_mínimo + safety   (the reorder trigger)
//   order_up_to = Σ yhat over (L + targetDoi) + safety
//   order_qty   = max(0, order_up_to − on_hand − open_receipts)  when on_hand ≤ ROP
//   stockout    = first day the net on-hand curve (stock + receipts − demand) ≤ 0
//   buy_by      = stockout − L                (if ≤ today, the PO is LATE)
//
// All open POs are treated as EXPECTED (by ETA), not confirmed-received. Receipts
// with a past ETA still count toward future availability (they are in transit).
// ─────────────────────────────────────────────────────────────────────────────

interface PurchaseInput {
  skuBase: string;
  skuName: string;
  forecast: SkuForecast | null;
  stock: StockState;
  orders: OpenPurchaseOrder[];
  policy: SkuPolicy;
  today: string;
}

const OPEN_STATUSES = new Set(['ordered', 'in_transit', 'customs']);

function riskFrom(status: PurchaseStatus, isLate: boolean): RiskLevel {
  if (status === 'CRITICAL' || isLate) return 'high';
  if (status === 'REORDER') return 'medium';
  return 'low';
}

export function purchaseForSku({
  skuBase,
  skuName,
  forecast,
  stock,
  orders,
  policy,
  today,
}: PurchaseInput): PurchaseSuggestion {
  const L = Math.max(0, Math.round(policy.leadTimeDays));
  const targetDoi = Math.max(0, Math.round(policy.targetDoi));
  const days = Math.max(HORIZON_DAYS, L + targetDoi);

  const demand = buildDailyDemand(forecast, days);
  const cumD = cumsum(demand.yhat);

  // Bucket expected open-PO receipts by arrival day-offset (overdue-but-open → day 0).
  const receipts = new Array<number>(days + 1).fill(0);
  let incomingUnits = 0;
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    const arrival = o.eta ?? (o.leadTimeDays != null ? addDays(o.orderDate, o.leadTimeDays) : null);
    if (!arrival) continue;
    let offset = diffDays(today, arrival);
    if (offset < 0) offset = 0;
    if (offset > days) continue;
    receipts[offset] += o.qty;
    incomingUnits += o.qty;
  }
  const cumReceipts = cumsum(receipts);

  const onHand = stock.total;
  // Estoque mínimo = consumo previsto integrado no lead time (Σ yhat over L).
  const expectedLeadTimeDemand = cumD[Math.min(L, days)];

  // Estoque de segurança absorve a variabilidade do CONSUMO no lead time. σ é
  // dimensionado por propagação de erro (igual à banda da projeção): σ do consumo
  // dos próximos 30 dias (RSS dos σ diários da banda do forecast), escalado ao lead
  // por √(lead em meses). Isto é Z·σ_mês·√(L/30) — NÃO a soma das bandas diárias,
  // que superestimava ~√L. σ_diário ≈ (hi − yhat) / 1,28.
  let sumSq30 = 0;
  const sigmaWindow = Math.min(30, days);
  for (let d = 1; d <= sigmaWindow; d++) {
    const sd = Math.max(0, (demand.hi[d] - demand.yhat[d]) / BAND_Z);
    sumSq30 += sd * sd;
  }
  const sigmaMonthly = Math.sqrt(sumSq30);
  const leadMonths = L / 30;
  const sigmaL = sigmaMonthly * Math.sqrt(leadMonths);
  const safety = policy.safetyOverride ?? ABC_Z[policy.abcClass] * sigmaL;
  const rop = expectedLeadTimeDemand + safety;
  const orderUpTo = cumD[Math.min(L + targetDoi, days)] + safety;

  // Net depletion: stock walked down by demand, topped up by expected receipts.
  let net = onHand;
  let stockoutDay: number | null = null;
  for (let d = 1; d <= days; d++) {
    net = net + receipts[d] - demand.yhat[d];
    if (stockoutDay === null && net <= 0 && demand.yhat[d] > 0) stockoutDay = d;
  }

  const needsReorder = onHand <= rop && demand.yhat.some((v) => v > 0);
  const receiptsInWindow = cumReceipts[Math.min(L + targetDoi, days)];
  const orderQty = needsReorder
    ? Math.max(0, Math.round(orderUpTo - onHand - receiptsInWindow))
    : 0;

  const status: PurchaseStatus =
    onHand < expectedLeadTimeDemand ? 'CRITICAL' : onHand < rop ? 'REORDER' : 'OK';

  const stockoutDate = stockoutDay != null ? addDays(today, stockoutDay) : null;
  const buyByDay = stockoutDay != null ? stockoutDay - L : null;
  const buyByDate = buyByDay != null ? addDays(today, buyByDay) : null;
  const isLate = buyByDay != null && buyByDay <= 0;

  const suggestedOrderDate =
    orderQty > 0 ? (isLate || buyByDate == null ? today : buyByDate) : null;
  const expectedArrival = suggestedOrderDate ? addDays(suggestedOrderDate, L) : null;

  const estCost = stock.unitPrice != null ? Math.round(orderQty * stock.unitPrice) : null;

  return {
    skuBase,
    skuName,
    abcClass: policy.abcClass,
    status,
    riskLevel: riskFrom(status, isLate),
    onHand,
    leadTimeDays: L,
    expectedLeadTimeDemand: round1(expectedLeadTimeDemand),
    sigmaMonthly: round1(sigmaMonthly),
    sigmaL: round1(sigmaL),
    safetyStock: round1(safety),
    rop: round1(rop),
    orderUpTo: round1(orderUpTo),
    orderQty,
    stockoutDate,
    buyByDate,
    isLate,
    suggestedOrderDate,
    expectedArrival,
    incomingUnits,
    estCost,
    reasoning: buildReasoning({
      status,
      onHand,
      rop,
      L,
      stockoutDate,
      buyByDate,
      isLate,
      orderQty,
      incomingUnits,
    }),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildReasoning(a: {
  status: PurchaseStatus;
  onHand: number;
  rop: number;
  L: number;
  stockoutDate: string | null;
  buyByDate: string | null;
  isLate: boolean;
  orderQty: number;
  incomingUnits: number;
}): string {
  if (a.status === 'OK' && a.orderQty === 0) {
    return `Estoque ${Math.round(a.onHand)} acima do ponto de recompra (${Math.round(a.rop)}); sem ação.`;
  }
  const parts: string[] = [];
  parts.push(
    `Estoque ${Math.round(a.onHand)} ${a.onHand < a.rop ? '<' : '≥'} ROP ${Math.round(a.rop)} (lead ${a.L}d)`,
  );
  if (a.stockoutDate) parts.push(`ruptura prevista ${a.stockoutDate}`);
  if (a.buyByDate) {
    parts.push(a.isLate ? `comprar JÁ (buy-by ${a.buyByDate} no passado — expedir)` : `comprar até ${a.buyByDate}`);
  }
  if (a.incomingUnits > 0) parts.push(`${a.incomingUnits} un. em pedidos abertos`);
  return parts.join('; ') + '.';
}

/** Run the purchase engine over many SKUs. Stock/policy/forecast keyed by sku_base. */
export function purchaseForAll(args: {
  stocks: StockState[];
  forecasts: Map<string, SkuForecast>;
  policies: Map<string, SkuPolicy>;
  ordersBySku: Map<string, OpenPurchaseOrder[]>;
  defaultPolicy: (skuBase: string, stock: StockState) => SkuPolicy;
  today: string;
}): PurchaseSuggestion[] {
  const { stocks, forecasts, policies, ordersBySku, defaultPolicy, today } = args;
  return stocks.map((stock) =>
    purchaseForSku({
      skuBase: stock.skuBase,
      skuName: stock.skuName,
      forecast: forecasts.get(stock.skuBase) ?? null,
      stock,
      orders: ordersBySku.get(stock.skuBase) ?? [],
      policy: policies.get(stock.skuBase) ?? defaultPolicy(stock.skuBase, stock),
      today,
    }),
  );
}
