// Explainers — the "?" hint content for every computed value in the planning UI.
// One entry per derived metric: a plain-language `what`, the `formula` (the actual
// calculation), and the `source`. Rendered by <InfoHint id="…" /> as a small popover.
//
// This is the user-facing companion to lineage.ts (Fontes & Fórmulas, technical) and
// the Guia do Usuário. Keep the formulas in sync with the engines they describe.

export interface Explainer {
  /** Short title shown in the popover header. */
  title: string;
  /** Plain-language: what the value means / how to read it. */
  what: string;
  /** The actual calculation (rendered monospace). */
  formula?: string;
  /** Where the inputs come from. */
  source?: string;
}

export const EXPLAINERS = {
  // ── Estoque & demanda ───────────────────────────────────────────────────────
  onhand: {
    title: 'Estoque on-hand',
    what: 'Unidades disponíveis agora (status AVAILABLE em depósito STORAGE), somadas por SKU e divididas entre os hubs Osasco, Mooca e SBC.',
    formula: 'onHand = Σ quantity WHERE inventory_status = AVAILABLE AND deposit_type = STORAGE',
    source: 'ClickHouse · stg_ims_r__inventory',
  },
  'daily-demand': {
    title: 'Demanda diária média',
    what: 'Consumo médio por dia nos primeiros 30 dias da previsão. É a base para Days-on-Hand e para a data de ruptura.',
    formula: 'avgDaily = Σ yhat[d] (d = 1..min(30, horizonte)) / 30',
    source: 'ClickHouse · sop_predictions_daily',
  },
  doh: {
    title: 'Days on Hand (DOH)',
    what: 'Quantos dias o estoque atual cobre, ao ritmo de consumo médio. Null quando não há demanda prevista.',
    formula: 'DOH = avgDaily > 0 ? onHand / avgDaily : —',
    source: 'Calculado',
  },
  'stockout-date': {
    title: 'Data de ruptura',
    what: 'Primeiro dia em que o estoque projetado (linha central yhat, já somando pedidos e recuperação) chega a zero.',
    formula: 'primeiro d > 0 com stock(d) ≤ 0 e demanda(d) > 0',
    source: 'Motor de projeção',
  },
  incoming: {
    title: 'Em trânsito (entradas)',
    what: 'Unidades de pedidos abertos (ordered / in_transit / customs) que chegam dentro do horizonte. Já descontadas da sugestão de compra.',
    formula: 'Σ qty dos POs com chegada (eta ou order_date + lead_time) ≤ horizonte',
    source: 'Supabase · purchase_order',
  },
  forecast: {
    title: 'Previsão de demanda (S&OP)',
    what: 'Previsão diária por SKU no nível-frota, vinda do modelo S&OP upstream. yhat é o valor central; lo/hi são a banda (≈ quantil 80%, ±1,28σ). O app não re-prevê — apenas consome.',
    formula: 'yhat, yhat_lo, yhat_hi por dia · as_of = último run',
    source: 'ClickHouse · sop_predictions_daily',
  },
  'stock-entry': {
    title: 'Entrada de estoque (pedido)',
    what: 'Um salto para cima no estoque histórico = uma entrada — pedido recebido (ou transferência). Marcado com 📦 e a quantidade que entrou no dia. Detectado direto do estoque real, mesmo quando o pedido não está registrado.',
    formula: 'marca o dia em que estoque(d) − estoque(d−1) ≥ máx(15, 20% do estoque anterior)',
    source: 'ClickHouse · mart_inventory_snapshot_daily',
  },
  band: {
    title: 'Banda otimista / pessimista',
    what: 'Faixa de incerteza da projeção. A linha de cima usa a demanda baixa (lo); a de baixo, a demanda alta (hi). Largura ≈ 1,28σ.',
    formula: 'stockHi: usa demandaLo · stockLo: usa demandaHi',
    source: 'Motor de projeção',
  },

  // ── Projeção ─────────────────────────────────────────────────────────────────
  'projection-line': {
    title: 'Projeção de estoque',
    what: 'Caminhada diária do estoque: parte do on-hand de hoje e, a cada dia, soma pedidos e recuperação e subtrai a demanda prevista.',
    formula: 'stock(d) = stock(d−1) + entradas + recuperação − demanda',
    source: 'Motor de projeção',
  },
  'recovery-line': {
    title: 'Projeção com recuperação',
    what: 'Mesma caminhada, creditando peças recuperadas em Osasco após o turnaround. A linha "sem recuperação" zera essa taxa para comparação.',
    formula: 'recuperação(d) = taxa × demanda(d − turnaround), se reparável',
    source: 'Motor de projeção',
  },

  // ── Política por SKU ───────────────────────────────────────────────────────
  'lead-time': {
    title: 'Lead time',
    what: 'Dias entre pedir e receber. O modal padrão (marítimo ou aéreo) define o lead efetivo usado no ROP e no buy-by. Internacional padrão: 110d mar / 40d aéreo; nacionais via seed/edição.',
    formula: 'leadTimeDays = defaultModal === "air" ? aéreo : marítimo',
    source: 'Supabase · sku_policy (+ seed nacional)',
  },
  'abc-class': {
    title: 'Classe ABC',
    what: 'Importância do SKU vinda da previsão. Dirige o Z do estoque de segurança e o DOI-alvo. Fallback "C".',
    formula: 'A → Z 1,96 · B → Z 1,65 · C → Z 1,28',
    source: 'ClickHouse · sop_predictions_daily',
  },

  // ── Motor de compras ─────────────────────────────────────────────────────────
  'expected-lead-demand': {
    title: 'Demanda no lead time',
    what: 'Total de unidades que se espera consumir durante o lead time — quanto precisa estar coberto só para aguentar a reposição.',
    formula: 'expectedLeadTimeDemand = Σ yhat[d] (d = 1..L)',
    source: 'Calculado',
  },
  'sigma-l': {
    title: 'σ no lead time (sigma_L)',
    what: 'Desvio-padrão da demanda ao longo do lead time, recuperado da largura da banda da previsão. Mede a incerteza que o estoque de segurança protege.',
    formula: 'sigma_L = (cumHi[L] − cumYhat[L]) / 1,28',
    source: 'Calculado',
  },
  safety: {
    title: 'Estoque de segurança',
    what: 'Colchão contra variação da demanda no lead time. Quanto maior a classe ABC e a incerteza, maior. Pode ser sobrescrito manualmente por SKU.',
    formula: 'safety = override ?? Z[ABC] × sigma_L',
    source: 'Calculado · sku_policy (override)',
  },
  rop: {
    title: 'Ponto de recompra (ROP)',
    what: 'Nível de estoque que dispara um novo pedido. Quando o on-hand cai a este ponto, é hora de comprar.',
    formula: 'ROP = demanda no lead time + estoque de segurança',
    source: 'Calculado',
  },
  'order-up-to': {
    title: 'Nível alvo (order-up-to)',
    what: 'Posição de estoque que o pedido busca atingir: cobre o lead time mais o DOI-alvo da classe, somado o estoque de segurança.',
    formula: 'orderUpTo = Σ yhat[1..L+DOI] + estoque de segurança',
    source: 'Calculado',
  },
  'order-qty': {
    title: 'Quantidade sugerida',
    what: 'Quanto comprar agora. Só dispara quando o on-hand está no/abaixo do ROP; desconta o que já vem em pedidos abertos.',
    formula: 'qty = max(0, orderUpTo − onHand − em trânsito), se onHand ≤ ROP',
    source: 'Calculado',
  },
  'purchase-status': {
    title: 'Status de compra',
    what: 'CRÍTICO: on-hand abaixo da própria demanda do lead time. REPOR: entre a demanda do lead e o ROP. OK: acima do ROP.',
    formula: 'onHand < demanda no lead → CRÍTICO · < ROP → REPOR · senão OK',
    source: 'Calculado',
  },
  'buy-by': {
    title: 'Comprar até',
    what: 'Data-limite para emitir o pedido e ainda receber antes da ruptura. No passado (Atrasado) significa expedir / trocar para aéreo.',
    formula: 'buyBy = data de ruptura − lead time',
    source: 'Calculado',
  },
  'est-cost': {
    title: 'Custo estimado',
    what: 'Quantidade sugerida × preço unitário do catálogo IMS. Atenção: preços do IMS podem ser uniformes/placeholder.',
    formula: 'estCost = qty × preço unitário',
    source: 'ClickHouse · stg_ims_r__item_group.price',
  },

  // ── Transferências ───────────────────────────────────────────────────────────
  'transfer-qty': {
    title: 'Quantidade a transferir',
    what: 'Unidades a mover na rota. No fluxo principal, o excedente de Osasco é rateado entre os spokes proporcional à falta de cada um.',
    formula: 'qty = round(min(falta do hub, excedente rateado de Osasco))',
    source: 'Motor de transferências',
  },
  'transfer-need': {
    title: 'Precisa até',
    what: 'Data em que o hub de destino projeta zerar o estoque dentro do ciclo, ao consumir sua parcela (share) da demanda.',
    formula: 'falta = max(0, demanda do ciclo × share − onHand do hub)',
    source: 'Motor de transferências',
  },
  'transfer-route': {
    title: 'Rota e ciclo',
    what: 'Origem → destino. Principal: a partir de Osasco (hub central). Fallback spoke-to-spoke quando Osasco não tem excedente. Ciclo 1 = esta terça; Ciclo 2 parte do estoque projetado pós-ciclo 1.',
    source: 'Motor de transferências',
  },
  'transfer-confidence': {
    title: 'Confiança',
    what: 'Quanto confiar na sugestão (0–100%). Combina a precisão da previsão na janela com o frescor dos dados. Fallback spoke-to-spoke leva ×0,7. Não é probabilidade de ruptura.',
    formula: 'confiança = clamp(precisão × frescor, 5%, 95%)',
    source: 'Calculado',
  },
  'transfer-precision': {
    title: 'Precisão da previsão',
    what: 'Quão "apertada" é a previsão na janela do ciclo. Usa o coeficiente de variação da demanda acumulada (não o dia-a-dia, que dispara em peças de baixo volume).',
    formula: 'cv = (banda acumulada / 1,28) / demanda acumulada\nprecisão = 1 / (1 + cv)',
    source: 'Calculado',
  },
  'transfer-freshness': {
    title: 'Frescor da previsão',
    what: 'O quão recente é o run da previsão. Decai linearmente até 0,3 quando o forecast tem 30+ dias. Mostrado à parte para que um forecast velho fique visível, em vez de baixar a confiança silenciosamente.',
    formula: 'frescor = clamp(1 − dias_desatualizado / 30, 0,3, 1)',
    source: 'Calculado · as_of do forecast',
  },

  // ── Grade semanal ──────────────────────────────────────────────────────────
  'week-stock': {
    title: 'Estoque no fim da semana',
    what: 'Estoque projetado no último dia de cada semana (amostragem da projeção de 150 dias nas fronteiras 7, 14, …, 56 dias).',
    formula: 'stock = timeline[semana × 7].stock',
    source: 'Motor de projeção',
  },
  'week-doh': {
    title: 'DOH na semana',
    what: 'Dias de cobertura no fim da semana. Vermelho = ruptura (≤ 0); amarelo = baixo (DOH < 14).',
    formula: 'DOH = demanda > 0 ? stock / demanda : —',
    source: 'Calculado',
  },
  'week-inbound': {
    title: 'Entradas na semana',
    what: 'Unidades de pedidos abertos que chegam dentro daquela semana (somadas nos 7 dias).',
    formula: 'Σ entradas nos dias [semana−6 .. semana]',
    source: 'Supabase · purchase_order',
  },
  'buy-by-week': {
    title: 'Semana de comprar',
    what: 'Coluna que marca a semana-limite para emitir o pedido (derivada do buy-by). Passado/imediato cai na semana 1.',
    formula: 'semana = max(1, ceil(dias até buyBy / 7))',
    source: 'Calculado',
  },

  // ── SKUs (tabela) ────────────────────────────────────────────────────────────
  'sku-doh': {
    title: 'DOH (tabela de SKUs)',
    what: 'Dias de cobertura derivados do lead time: usa a demanda diária implícita na demanda do lead time.',
    formula: 'dailyDemand = demanda no lead time / lead time · DOH = onHand / dailyDemand',
    source: 'Calculado',
  },

  // ── Recuperação ───────────────────────────────────────────────────────────────
  'recovery-rate': {
    title: 'Taxa de recuperação (usada)',
    what: 'Fração da demanda que volta como peça recuperada em Osasco, creditada após o turnaround. É o valor que o motor usa — editável por SKU.',
    formula: 'recuperação(d) = taxa × demanda(d − turnaround)',
    source: 'Supabase · sku_policy.recovery_rate',
  },
  'recovery-observed': {
    title: 'Taxa real IMS (observada)',
    what: 'Taxa medida no histórico do IMS nos últimos 90 dias (reparos vs. consumo). É informativa; o cron semanal a grava em sku_policy. Acima de 100% vira 0 por padrão.',
    formula: 'taxa = reparados (RECONDITION) / consumidos (USAGE) nos últimos 90d',
    source: 'ClickHouse · stg_ims_r__ledger',
  },
  'recovery-turnaround': {
    title: 'Turnaround de recuperação',
    what: 'Dias de reparo antes de creditar a peça recuperada de volta em Osasco. Padrão 14 dias.',
    formula: 'defaso aplicado: demanda(d − turnaround)',
    source: 'Supabase · sku_policy',
  },

  // ── Alocação ───────────────────────────────────────────────────────────────
  'hub-share': {
    title: 'Share do hub',
    what: 'Parcela da demanda da rede que cabe a cada hub, pelo consumo dos últimos 30 dias (IMS). Sem histórico, cai na distribuição do on-hand; por fim, 1/3 para cada.',
    formula: 'share[hub] = consumo 30d do hub / consumo 30d total',
    source: 'ClickHouse · stg_ims_r__ledger',
  },
} satisfies Record<string, Explainer>;

export type ExplainerId = keyof typeof EXPLAINERS;
