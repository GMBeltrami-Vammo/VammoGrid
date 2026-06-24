// Data lineage reference — the complete, technical description of every value and
// formula in the planning platform, with its source (ClickHouse / Supabase /
// Metabase / seed) and a file:line ref. Rendered by /dashboard/fontes.
//
// Extracted + adversarially verified against the source files. Keep in sync when
// the engines or adapters change (refs point to the authoritative code).

export interface LineageRow {
  name: string;
  source: string;
  formula: string;
  notes: string;
  ref: string;
}

export interface LineageSection {
  title: string;
  blurb: string;
  rows: LineageRow[];
}

export const LINEAGE_SECTIONS: LineageSection[] = [
  {
    title: 'Fontes de dados',
    blurb:
      'As fontes brutas que alimentam o planejamento — tabelas ClickHouse (analytics/dev), tabelas Supabase fleet, questions do Metabase, constantes de hub e o seed de lead times nacionais. Uma linha por fonte descrevendo o que ela fornece.',
    rows: [
      {
        name: 'Backend de analytics (activeBackendKind / chQuery)',
        source: 'Env: CLICKHOUSE_HOST/USER/PASSWORD/DATABASE ou METABASE_URL/METABASE_API_KEY/METABASE_CH_DATABASE_ID (default 137)',
        formula:
          "Se CLICKHOUSE_HOST setado → 'clickhouse' (POST HTTP Basic, body + 'FORMAT JSONEachRow', parse linha-a-linha); senão se METABASE_URL+API_KEY → 'metabase' (POST /api/dataset {database, type:'native', native:{query}}, reindexa rows[][]+cols[] para objetos); senão 'none'",
        notes:
          "Read-only, server-only, sem dependências (fetch puro), cache:'no-store'. Backend cacheado por processo. chQuery() roda o mesmo SQL nativo em qualquer um dos dois. Tabelas sempre qualificadas (analytics.*, dev.*).",
        ref: 'src/lib/clickhouse/reader.ts:20-122',
      },
      {
        name: 'analytics.stg_ims_r__inventory (+ deposit/location/item/item_group)',
        source: 'ClickHouse — lineage IMS (inventory→deposit→location→item→item_group)',
        formula:
          "item_code, item_group_name, is_repairable, compatible_asset, toFloat64(price), location_id, sum(toFloat64(quantity)) WHERE inventory_status='AVAILABLE' AND deposit_type='STORAGE' AND location_id IN (34,1,166)",
        notes:
          'Universo de estoque on-hand para planejamento (AVAILABLE+STORAGE; DEPLOYED/RESERVED fora). Base de StockState e das shares on-hand.',
        ref: 'src/lib/planning/source/stock.ts:21-38',
      },
      {
        name: 'analytics.stg_ims_r__ledger',
        source: 'ClickHouse — razão IMS de movimentações',
        formula:
          'delta por ledger_type: USAGE% (consumo) e RECONDITION (recuperação), com created_at em janelas de 30d (shares) / 90d (recovery)',
        notes:
          'Fonte de duas derivações: hub shares (USAGE% 30d) e taxa de recuperação histórica (RECONDITION vs USAGE% 90d). Indisponível → callers caem em fallback (mapa vazio).',
        ref: 'src/lib/planning/source/shares.ts:18-30; recovery.ts:18-28',
      },
      {
        name: 'analytics.mart_inventory_snapshot_daily',
        source: 'ClickHouse — mart diário de estoque, keyed por sku_base',
        formula:
          'SELECT toString(snapshot_date), toFloat64(sum(quantity_available)) WHERE sku_base=? AND snapshot_date >= today()-days GROUP BY snapshot_date ORDER BY snapshot_date',
        notes:
          'Total de rede (sem split por hub). Mesma lineage do estoque vivo (int_inventory) → casa com o on-hand exibido, diferente do fleet.piece_stock_hub (naming Maestro #29571 diverge). Base do histórico D-30.',
        ref: 'src/lib/planning/source/history.ts:51-58',
      },
      {
        name: 'dev.sop_predictions_daily',
        source: 'ClickHouse — forecast de demanda upstream (último run)',
        formula:
          'sku_base, abc_class, model_version, as_of_date, target_date, horizon_day, toFloat64(yhat/yhat_lo/yhat_hi) WHERE as_of_date=(SELECT max(as_of_date) …)',
        notes:
          'yhat/lo/hi diário por sku_base, nível-frota. Não há re-forecast: trocar modelo = trocar tabela/model_version sem mudar engine. asOfDate = max(as_of_date) slice(0,10).',
        ref: 'src/lib/planning/source/forecast.ts:21-28',
      },
      {
        name: 'dev.sop_alerts',
        source: 'ClickHouse — alertas de cobertura SOP (último run)',
        formula:
          'sku_base, location, abc_class, alert_code, severity, reason, metrics, toFloat64(unit_price) WHERE as_of_date=(max …); filtra KNOWN_CODES (STK_RUPTURE, STK_BELOW_ROP, STK_BELOW_SS, DEM_TREND_UP, DEM_VARIABILITY, STK_OBSOLETE)',
        notes:
          "location='ALL' (nível-frota); engines somam alertas por-hub depois. metrics é JSON → Record<string,number>; severity coagida a critical|warning|info; hub a HubId|'ALL'.",
        ref: 'src/lib/planning/source/alerts.ts:21-73',
      },
      {
        name: 'fleet.purchase_order',
        source: 'Supabase fleet (anon key, RLS) — alimentado por n8n / manual / xlsx',
        formula: 'fetchOpenOrders(): SELECT * order by order_date DESC, sem filtro de status; mapeia para OpenPurchaseOrder',
        notes:
          "Campos: id, vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source. Defaults: status='ordered', hubId='osasco', source='manual'. [] em erro/desconfigurado.",
        ref: 'src/lib/planning/source/orders.ts:30-57',
      },
      {
        name: 'fleet.sku_policy',
        source: 'Supabase fleet (service-role; metadado server-only fora do anon key)',
        formula:
          'fetchSkuPolicies() via createServiceSupabase(): SELECT *; retorna Map<sku_base, Partial<SkuPolicy>>. Só colunas presentes sobrescrevem defaults',
        notes:
          'Colunas: lead_time_days/source/sea_days/air_days, default_modal, abc_class, target_doi, recovery_rate, recovery_turnaround_days, safety_override, is_repairable, updated_by/at. Service role passa RLS; autorização no caller.',
        ref: 'src/lib/planning/source/policies.ts:26-64; supabase/service.ts:15-28',
      },
      {
        name: 'fleet.part_compat',
        source: 'Supabase fleet (anon key) — matriz de 9 modelos de moto',
        formula:
          'fetchCompatModels(): por linha, checa colunas BIKE_MODELS (MODEL_A1, MODEL_B3, MODEL_S2, …) == true → Set; retorna Map<sku_base, Set<model>>',
        notes:
          'O warehouse só conhece categoria grossa (BIKE/BATTERY/BOX); o detalhe por modelo vem daqui. Mapa vazio em erro → filtro não restringe por modelo.',
        ref: 'src/lib/planning/source/compat.ts:11-28',
      },
      {
        name: 'Metabase #29571 (Inventory + DOH)',
        source: 'ClickHouse via Metabase (consumo Maestro OS L30D)',
        formula:
          'Linha: sku, item_group (nome Maestro), qty_total/qty_mooca/qty_osasco/qty_sbc, consumo_diario_mooca/osasco/sbc, consumo_diario_l30d (= soma hubs), doh (= qty_total/consumo_diario_l30d)',
        notes:
          "Mismatch de naming: 'item_group' (Maestro) ≠ ClickHouse 'item_group_name' — por isso o cron fleet.piece_stock_hub não casa por nome. Default da question = env.METABASE_QUESTION_INVENTORY || 29571.",
        ref: 'src/lib/transformer.ts:13-39; metabase/queries.ts:1-3',
      },
      {
        name: 'Metabase #29567 (Consumption)',
        source: 'ClickHouse via Metabase (consumo diário + IDs de OS, média móvel L30D)',
        formula:
          'Linha: day (ISO), item_group (nome Maestro), hub (mooca|osasco|sbc), qty_consumed, os (array de IDs, pode vir como string JSON), monthly_avg',
        notes:
          'os parseado de array ou string JSON ([] em erro). Valida hub contra VALID_HUBS. Default da question = env.METABASE_QUESTION_CONSUMPTION || 29567.',
        ref: 'src/lib/transformer.ts:74-116; metabase/queries.ts:5-6',
      },
      {
        name: 'HUBS / HUB_LOCATION_IDS (constantes de hub)',
        source: 'src/constants/planningHubs.ts — validado contra analytics.stg_ims_r__location',
        formula:
          "osasco=34 (isCentral), mooca=1, sbc=166; HUB_LOCATION_IDS = '34,1,166'. HUB_BY_LOCATION faz o reverso (34→osasco, …)",
        notes:
          'Injetado em WHERE loc.location_id IN (…). Osasco = distribuição + recuperação central; coords aproximadas p/ o mapa de transferências.',
        ref: 'src/constants/planningHubs.ts:6-24',
      },
      {
        name: 'NATIONAL_LEAD_TIMES (seed)',
        source: "src/lib/planning/seed/nationalLeadTimes.ts — 'lead time estimado - pecas nacionais.xlsx'",
        formula: 'Record<sku_base, leadDays>: 17 peças nacionais (14–30 dias). Ausentes = internacional (110d mar / 40d aéreo)',
        notes: 'Seed inicial keyed por sku_base; fleet.sku_policy sobrescreve quando populado e editável in-app.',
        ref: 'src/lib/planning/seed/nationalLeadTimes.ts:1-24',
      },
      {
        name: 'toSkuBase (chave normalizada de SKU)',
        source: 'item_code do IMS, via toSkuBase() em ../sku.ts',
        formula: 'skuBase = toSkuBase(String(sku_code)) — primeiros 4 segmentos do código',
        notes:
          'Chave primária em estoque, forecast, shares, recovery e histórico. Toda agregação é no nível sku_base, não nas variantes sku_code.',
        ref: 'src/lib/planning/source/stock.ts:49; forecast.ts:48; shares.ts:42',
      },
    ],
  },
  {
    title: 'Estoque & demanda',
    blurb:
      'As séries que entram no motor: estoque on-hand por hub, forecast diário de demanda nível-frota, shares de demanda por hub e o histórico de on-hand dos últimos 30 dias.',
    rows: [
      {
        name: 'StockState (on-hand por SKU e por hub)',
        source: 'analytics.stg_ims_r__inventory (lineage IMS)',
        formula:
          'Agrega rows por sku_base: byHub[HUB_BY_LOCATION[location_id]] += qty; total += qty; unitPrice = max(price); isRepairable = OR; sorted by total DESC',
        notes:
          'byHub inicia {osasco:0,mooca:0,sbc:0}; pula linha se hub desconhecido. Saída StockState{byHub, total, unitPrice, isRepairable, category, lastUpdated}.',
        ref: 'src/lib/planning/source/stock.ts:44-77',
      },
      {
        name: 'SkuForecast (forecast de demanda nível-frota)',
        source: 'dev.sop_predictions_daily (último run)',
        formula:
          "Por sku_base: abcClass=asAbc(s); horizonDays=max(horizon_day); points[]={day, date, yhat, lo, hi} sorted by day ASC; asOfDate=max(as_of_date)",
        notes: 'Diário yhat/lo/hi por sku_base, nível-frota (split por hub só na alocação). Bundle{bySku, asOfDate}. Sem re-forecast.',
        ref: 'src/lib/planning/source/forecast.ts:41-78',
      },
      {
        name: 'HubShares (share de demanda por hub)',
        source: 'analytics.stg_ims_r__ledger (USAGE% 30d)',
        formula: 'used[hub] += abs(toFloat64(delta)); share[hub] = used[hub] / (Σ used), só se total>0',
        notes:
          'Consumo móvel 30d, abs(delta) p/ variância de sinal. Mapa vazio se ledger indisponível. SKU ausente → resolveShares cai no on-hand.',
        ref: 'src/lib/planning/source/shares.ts:32-60',
      },
      {
        name: 'StockHistory (on-hand histórico 30d, split por hub)',
        source: 'analytics.mart_inventory_snapshot_daily',
        formula:
          'global[]={date, stock=round(sum(quantity_available))}; share[h]=currentByHub[h]/total; byHub[h]={date, round(global_stock × share[h])}',
        notes:
          'Global = total de rede; por-hub = global × share on-hand atual (cada série aterrissa no estoque de hoje em D0). days=30; emptyHistory em falha. Anti-injection: safeBase.',
        ref: 'src/lib/planning/source/history.ts:43-90',
      },
    ],
  },
  {
    title: 'Política por SKU',
    blurb:
      'Como cada SKU ganha sua política efetiva: lead times mar/aéreo/default, classe ABC com Z de nível de serviço e target DOI, parâmetros de recuperação, e a precedência override→seed→ABC.',
    rows: [
      {
        name: 'Resolução de SkuPolicy (precedência)',
        source: 'src/lib/planning/policy.ts — defaultPolicyFor() + buildPolicies()',
        formula:
          "Precedência: (1) override fleet.sku_policy → (2) NATIONAL_LEAD_TIMES[skuBase] seed → (3) defaults ABC. Nacional: seaDays=airDays=seed; senão sea=110, air=40. leadTimeDays = defaultModal==='sea' ? seaDays : airDays",
        notes: 'Até sku_policy ser populada, todo SKU ganha defaults sensatos. Override explícito de leadTimeDays vence quando sea/air não estão ambos setados.',
        ref: 'src/lib/planning/policy.ts:12-72',
      },
      {
        name: 'DEFAULT_LEAD_TIME_DAYS (mar, internacional)',
        source: 'src/lib/planning/constants.ts',
        formula: 'DEFAULT_LEAD_TIME_DAYS = 110',
        notes: 'Lead marítimo padrão p/ peças internacionais; usado quando sku_base não está em NATIONAL_LEAD_TIMES.',
        ref: 'src/lib/planning/constants.ts:13',
      },
      {
        name: 'INTERNATIONAL_AIR_LEAD_DAYS (aéreo)',
        source: 'src/lib/planning/constants.ts',
        formula: 'INTERNATIONAL_AIR_LEAD_DAYS = 40',
        notes: 'Opção aérea (mais rápida, mais cara): sea=110 → air=40 em SKUs não-nacionais.',
        ref: 'src/lib/planning/constants.ts:16',
      },
      {
        name: 'ABC_Z (Z de nível de serviço)',
        source: 'src/lib/planning/constants.ts — port do spare-parts-forecast-lab',
        formula: 'ABC_Z = { A: 1.96, B: 1.65, C: 1.28 }',
        notes: 'Z aplicado no estoque de segurança: safety = ABC_Z[abcClass] × sigma_L.',
        ref: 'src/lib/planning/constants.ts:7',
      },
      {
        name: 'ABC_TARGET_DOI (target days-of-inventory)',
        source: 'src/lib/planning/constants.ts; policy.ts',
        formula: 'ABC_TARGET_DOI = { A: 30, B: 45, C: 60 }; targetDoi default = ABC_TARGET_DOI[abcClass]',
        notes: 'Cobertura-alvo além do lead time (order-up-to). O engine usa policy.targetDoi diretamente.',
        ref: 'src/lib/planning/constants.ts:10; policy.ts:31,61',
      },
      {
        name: 'AbcClass',
        source: 'dev.sop_predictions_daily.abc_class (forecast) ou fallback',
        formula: "AbcClass = 'A'|'B'|'C'; asAbc(s) = (s==='A'||s==='B') ? s : 'C'",
        notes: "Classe de importância do forecast (fallback 'C'). Dirige targetDoi, Z de safety e prioridade de serviço.",
        ref: 'src/lib/planning/source/forecast.ts:30-32; policy.ts:49',
      },
      {
        name: 'DEFAULT_RECOVERY_TURNAROUND_DAYS',
        source: 'src/lib/planning/policy.ts',
        formula: 'DEFAULT_RECOVERY_TURNAROUND_DAYS = 14',
        notes: 'Turnaround de reparo (dias) antes de creditar unidades recuperadas em Osasco. Usado salvo override.',
        ref: 'src/lib/planning/policy.ts:10,33',
      },
      {
        name: 'HistoricalRecovery (taxa de recuperação observada — IMS)',
        source: 'analytics.stg_ims_r__ledger (RECONDITION vs USAGE% 90d)',
        formula:
          "recovered = sumIf(abs(delta), ledger_type='RECONDITION'); consumed = sumIf(abs(delta), ledger_type LIKE 'USAGE%') WHERE created_at >= now()-INTERVAL 90 DAY HAVING consumed>0; rate = recovered/consumed",
        notes:
          'Lookback 90d. Valor OBSERVADO (não realimenta o engine direto). O cron semanal /api/recovery/refresh grava em sku_policy.recovery_rate; rate observado > 100% → 0 por padrão.',
        ref: 'src/lib/planning/source/recovery.ts:18-63; recoveryRefresh.ts',
      },
      {
        name: 'SkuPolicy (contrato de domínio)',
        source: '@/types/planning — produzido por adapters (Supabase, seed)',
        formula:
          'skuBase, leadTimeDays (efetivo, do defaultModal), leadTimeSource, leadTimeSeaDays/AirDays, defaultModal, abcClass, targetDoi, recoveryRate, recoveryTurnaroundDays, safetyOverride (null=calculado), isRepairable, updatedBy/At',
        notes: 'Interface de política estável da qual todos os engines dependem; adapters apenas produzem essa forma.',
        ref: '@/types/planning (SkuPolicy)',
      },
    ],
  },
  {
    title: 'Motor de projeção',
    blurb:
      'O passo-a-passo diário do estoque (stock walk) por escopo (global e cada hub): consumo da demanda, entradas de PO, crédito de recuperação, bandas otimista/pessimista, DOH e detecção de ruptura.',
    rows: [
      {
        name: 'HORIZON_DAYS',
        source: 'src/lib/planning/constants.ts',
        formula: 'HORIZON_DAYS = 150',
        notes: 'Horizonte de planejamento padrão; projeções vão a 150 dias salvo override.',
        ref: 'src/lib/planning/constants.ts:19',
      },
      {
        name: 'buildDailyDemand (pontos + extrapolação tail-mean)',
        source: 'src/lib/planning/forecast.ts',
        formula:
          'Para d∈[1,days]: yhat[d]=byDay.get(d).yhat (idem lo/hi); sem ponto → tailY=mean(últimos tailWindow=14 pontos). horizon=fc.horizonDays',
        notes: 'Forecast esparso vira array denso por índice de dia; estende demanda constante além do horizonte do modelo (lab opCumArr).',
        ref: 'src/lib/planning/forecast.ts:19-55',
      },
      {
        name: 'cumsum',
        source: 'src/lib/planning/forecast.ts',
        formula: 'out[i] = Σ arr[0..i]',
        notes: 'Prefix sum; base de demanda acumulada em janelas multi-dia (usado no motor de compras).',
        ref: 'src/lib/planning/forecast.ts:65-73',
      },
      {
        name: 'resolveShares (shares por hub)',
        source: 'src/lib/planning/allocation.ts',
        formula:
          'shares = provided ? normalize(provided, Σprovided) : (stock.total>0 ? normalize(byHub, stock.total) : {1/3,1/3,1/3})',
        notes: 'Prioridade: (1) provided (consumo IMS), (2) distribuição on-hand, (3) split igual. Aplica só quando soma>0.',
        ref: 'src/lib/planning/allocation.ts:18-34',
      },
      {
        name: 'scaleDemand (demanda por hub)',
        source: 'src/lib/planning/projection.ts',
        formula: 'demand(h) = scaleDemand(fleet, shares[h]) → yhat/lo/hi cada × shares[h] em todos os dias',
        notes: 'Demanda nível-frota × share do hub; cada stream recebe demanda diária escalada independentemente.',
        ref: 'src/lib/planning/projection.ts:50-58,178',
      },
      {
        name: 'Stock walk diário (equação central)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'stock = stock + inbound + recovery − demand; stockHi = stockHi + inbound + recovery − demandLo; stockLo = stockLo + inbound + recovery − demandHi',
        notes:
          'Walk recursivo d=0..horizon. d=0: demand/recovery=0 → só inbound. stockHi usa demanda baixa (otimista); stockLo usa demanda alta (pessimista). transferIn/Out hardcoded 0.',
        ref: 'src/lib/planning/projection.ts:89-119',
      },
      {
        name: 'Bandas (stockLo pessimista / stockHi otimista)',
        source: 'src/lib/planning/projection.ts',
        formula: 'demandHi/Lo = d===0?0:demand.hi/lo[d]; saída clampada: max(0, round(…))',
        notes: 'Banda ≈ 1,28σ (aprox. quantil 80%). Negativos clampados a 0.',
        ref: 'src/lib/planning/projection.ts:91-111',
      },
      {
        name: 'Crédito de recuperação (recovery)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'recovery = (creditsRecovery && isRepairable && d − recoveryTurnaround >= 1) ? recoveryRate × (demand.yhat[d − recoveryTurnaround] ?? 0) : 0',
        notes: 'Baseado na demanda DO PRÓPRIO escopo, defasada pelo turnaround (Osasco usa demanda share-scaled de Osasco). turnaround default 14.',
        ref: 'src/lib/planning/projection.ts:95-98',
      },
      {
        name: 'bucketReceipts (entradas de PO)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'Para cada PO aberto (status∈{ordered,in_transit,customs}): arrival = eta ?? (orderDate+leadTimeDays); offset=diffDays(today,arrival); offset<0→0; offset>horizon→skip; receipts[offset]+=qty',
        notes: 'POs atrasados-mas-abertos vão p/ dia 0. POs sem eta nem leadTimeDays produzem arrival null e são pulados.',
        ref: 'src/lib/planning/projection.ts:36-48',
      },
      {
        name: 'Escopo de entradas / recuperação (global vs hub)',
        source: 'src/lib/planning/projection.ts',
        formula:
          "receipts: global e osasco recebem receiptsGlobal; mooca/sbc = zeros. creditsRecovery: global=true, osasco=true, mooca/sbc=false",
        notes: 'POs aterrissam só em Osasco; recuperação creditada ao total global e a Osasco. Spokes não acumulam entradas nem recuperação.',
        ref: 'src/lib/planning/projection.ts:153-182',
      },
      {
        name: 'dohNow (Days on Hand inicial)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'window = min(30, horizon); avgDaily = Σ(demand.yhat[d] d=1..window)/window; dohNow = avgDaily>0 ? startStock/avgDaily : null → round1',
        notes: 'Média diária sobre os primeiros min(30,horizon) dias (exclui d=0). Null quando avgDaily=0.',
        ref: 'src/lib/planning/projection.ts:84-128',
      },
      {
        name: 'stockoutDate (ruptura)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'if (stockoutDay===null && d>0 && stock<=0 && avgDaily>0) stockoutDay=d; stockoutDate = stockoutDay!=null ? addDays(today, stockoutDay) : null',
        notes: 'Primeiro d>0 onde o walk central (yhat) <= 0, com avgDaily>0. Testa o stock central, não as bandas.',
        ref: 'src/lib/planning/projection.ts:104,129-130',
      },
      {
        name: 'projectSku / projectStream (saída StockProjection)',
        source: 'src/lib/planning/projection.ts',
        formula:
          'projectSku → {global, byHub{osasco,mooca,sbc}}; cada StockProjection: currentStock, dailyDemand (avg 30d), dohNow, stockoutDate, daysUntilStockout, incomingUnits, timeline (ProjectionPoint[] d=0..horizon)',
        notes: 'ProjectionPoint: date, day, stock, stockLo, stockHi, demand, inbound, recovery, transferIn=0, transferOut=0, extrapolated (d>demand.horizon).',
        ref: 'src/lib/planning/projection.ts:75-190',
      },
    ],
  },
  {
    title: 'Motor de compras',
    blurb:
      'Política (s,S) determinística por SKU: demanda esperada no lead time, sigma, estoque de segurança, ROP, order-up-to, quantidade, status, ruptura, buy-by e custo. Port do forecast-lab.',
    rows: [
      {
        name: 'L (lead time) e janela days',
        source: 'src/lib/planning/purchase.ts — policy.leadTimeDays / targetDoi',
        formula: 'L = max(0, round(policy.leadTimeDays)); targetDoi = max(0, round(policy.targetDoi)); days = max(HORIZON_DAYS, L + targetDoi)',
        notes: 'L e targetDoi arredondados/clampados ≥0; days estende o horizonte de cálculo p/ cobrir L+targetDoi.',
        ref: 'src/lib/planning/purchase.ts:60-62',
      },
      {
        name: 'expectedLeadTimeDemand',
        source: 'cumD = cumsum(demand.yhat)',
        formula: 'expectedLeadTimeDemand = cumD[min(L, days)]',
        notes: 'Demanda yhat acumulada na janela de lead time L. Subjaz sigma_L, ROP e status.',
        ref: 'src/lib/planning/purchase.ts:64-84',
      },
      {
        name: 'sigma_L',
        source: 'cumHi, cumD',
        formula: 'sigmaL = max(0, (cumHi[min(L,days)] − expectedLeadTimeDemand) / BAND_Z), BAND_Z=1.28',
        notes: 'σ recuperado da largura da banda do forecast (quantil ~80% ≈ 1,28σ). Clampado ≥0.',
        ref: 'src/lib/planning/purchase.ts:85; constants.ts:23',
      },
      {
        name: 'safety (estoque de segurança)',
        source: 'policy.safetyOverride ou ABC_Z[abcClass]',
        formula: 'safety = policy.safetyOverride ?? ABC_Z[policy.abcClass] × sigmaL',
        notes: 'Override tem precedência via ?? (null cai no calculado). ABC_Z={A:1.96,B:1.65,C:1.28}.',
        ref: 'src/lib/planning/purchase.ts:86',
      },
      {
        name: 'ROP (ponto de recompra)',
        source: 'derivado',
        formula: 'rop = expectedLeadTimeDemand + safety',
        notes: 'Gatilho de recompra (needsReorder: onHand<=rop) e fronteira de status (onHand<rop → REORDER).',
        ref: 'src/lib/planning/purchase.ts:87',
      },
      {
        name: 'orderUpTo (nível alvo)',
        source: 'cumD + safety',
        formula: 'orderUpTo = cumD[min(L + targetDoi, days)] + safety',
        notes: 'Cobre lead + targetDoi mais o safety.',
        ref: 'src/lib/planning/purchase.ts:88',
      },
      {
        name: 'orderQty (quantidade a comprar)',
        source: 'orderUpTo, onHand, receiptsInWindow',
        formula:
          'needsReorder = onHand<=rop && demand.yhat.some(v=>v>0); orderQty = needsReorder ? max(0, round(orderUpTo − onHand − cumReceipts[min(L+targetDoi, days)])) : 0',
        notes: 'needsReorder exige onHand<=rop E ao menos um yhat positivo. Desconta entradas abertas na janela.',
        ref: 'src/lib/planning/purchase.ts:98-102',
      },
      {
        name: 'status (CRITICAL/REORDER/OK)',
        source: 'onHand, expectedLeadTimeDemand, rop',
        formula: "status = onHand < expectedLeadTimeDemand ? 'CRITICAL' : onHand < rop ? 'REORDER' : 'OK'",
        notes: 'Comparações estritas <. CRITICAL abaixo da demanda de lead; REORDER entre demanda de lead e ROP; OK acima.',
        ref: 'src/lib/planning/purchase.ts:104-105',
      },
      {
        name: 'stockoutDate (compras)',
        source: 'curva de depleção líquida',
        formula:
          'net=onHand; for d=1..days: net += receipts[d] − demand.yhat[d]; if (stockoutDay===null && net<=0 && demand.yhat[d]>0) stockoutDay=d',
        notes: 'Net corrente (≡ onHand + cumReceipts[d] − cumD[d]); primeiro d com net<=0 E demanda positiva nesse dia.',
        ref: 'src/lib/planning/purchase.ts:91-107',
      },
      {
        name: 'buyByDate / isLate',
        source: 'stockoutDay, L',
        formula: 'buyByDay = stockoutDay − L; buyByDate = addDays(today, buyByDay); isLate = buyByDay <= 0',
        notes: 'isLate = comprar até hoje ou antes. buyByDate pode estar no passado (internacionais com lead ≈ horizonte).',
        ref: 'src/lib/planning/purchase.ts:108-110',
      },
      {
        name: 'suggestedOrderDate / expectedArrival',
        source: 'isLate, buyByDate, L',
        formula:
          'suggestedOrderDate = orderQty>0 ? (isLate || buyByDate==null ? today : buyByDate) : null; expectedArrival = suggestedOrderDate ? addDays(+L) : null',
        notes: 'Só setado quando orderQty>0; hoje se atrasado ou sem ruptura projetada, senão buyByDate.',
        ref: 'src/lib/planning/purchase.ts:112-114',
      },
      {
        name: 'estCost (custo estimado)',
        source: 'stock.unitPrice (analytics.stg_ims_r__item_group.price), orderQty',
        formula: 'estCost = stock.unitPrice != null ? round(orderQty × stock.unitPrice) : null',
        notes: "Preço unitário vem do catálogo IMS (ig.price). Null quando desconhecido; '—' na UI. Atenção: preços IMS podem ser uniformes/placeholder.",
        ref: 'src/lib/planning/purchase.ts:116; stock.ts:27',
      },
    ],
  },
  {
    title: 'Grade semanal & transferências',
    blurb:
      'A visão semanal (amostragem da projeção de 150 dias em fronteiras de semana) e o motor de transferências hub-and-spoke via Osasco, com fallback spoke-to-spoke e confiança.',
    rows: [
      {
        name: 'Janela de amostragem WeekGrid',
        source: 'src/lib/planning/weekgrid.ts',
        formula: 'DEFAULT_WEEKS=8; semanas idx=1..8, dayOffset=(i+1)×7 (7,14,…,56), endDate=addDays(today, dayOffset)',
        notes: '8 semanas = 56 dias, dentro do horizonte de 90d → sem extrapolação. View pura da projeção.',
        ref: 'src/lib/planning/weekgrid.ts:29-94',
      },
      {
        name: 'WeekCell — stock, DOH, entradas/recuperação',
        source: 'src/lib/planning/weekgrid.ts',
        formula:
          'stock = timeline[dayOffset].stock; doh = demand>0 ? round(stock/demand) : null; inbound/recovery = Σ sobre [dayOffset−6 .. dayOffset]',
        notes: 'Stock e DOH de fim de semana; inbound (POs chegando) e recovery agregados à semana. doh null sem demanda.',
        ref: 'src/lib/planning/weekgrid.ts:48-72',
      },
      {
        name: 'WeekCell — flags isOut / isLow',
        source: 'src/lib/planning/weekgrid.ts',
        formula: 'isOut = stock<=0; isLow = (doh!=null && doh < LOW_DOH_THRESHOLD), LOW_DOH_THRESHOLD=14',
        notes: 'Flags de ruptura e estoque baixo no fim da semana (dirigem a cor da célula).',
        ref: 'src/lib/planning/weekgrid.ts:30,68-69',
      },
      {
        name: 'buyByWeek (semana-limite de compra)',
        source: 'src/lib/planning/weekgrid.ts',
        formula: 'offset = diffDays(today, buyByDate); if offset > weeks×7 → null; else max(1, ceil(offset/7))',
        notes: 'Mapeia buy-by à coluna de semana (1-based). Passado/próximo → semana 1; além da grade → null.',
        ref: 'src/lib/planning/weekgrid.ts:74-80',
      },
      {
        name: 'buildWeekGrid (escopos + ordenação)',
        source: 'src/lib/planning/weekgrid.ts',
        formula:
          "WeekGrid { weeks, global, byHub{osasco,mooca,sbc} }; cada linha reusa projectSku(); sort por firstOutWeek (Infinity se nunca rompe) depois skuName (pt-BR)",
        notes: 'Os 4 escopos computados server-side (toggle de UI instantâneo). Função pura/determinística; consistente com projectSku().',
        ref: 'src/lib/planning/weekgrid.ts:82-151',
      },
      {
        name: 'Config de transferências (defaults)',
        source: 'src/lib/planning/transfer.ts',
        formula: 'cycleDays=7; transitDays={osasco:0, mooca:1, sbc:2}; spokeToSpokeTransitDays=1; minQty=1',
        notes: 'Ciclo semanal; Osasco mesmo-dia, spokes 1–2 dias; spoke-to-spoke 1 dia.',
        ref: 'src/lib/planning/transfer.ts:30-35',
      },
      {
        name: 'Necessidade do hub (computeHubNeed)',
        source: 'src/lib/planning/transfer.ts',
        formula:
          'demandCov = Σ(yhat[1..coverage] × share); need = max(0, demandCov − onHand); coverage = cycleDays + transitDays[hub]',
        notes: 'needByDate = addDays(today, stockoutDay). Base do roteamento de transferências.',
        ref: 'src/lib/planning/transfer.ts:62-95',
      },
      {
        name: 'Disponibilidade de Osasco + alocação pro-rata',
        source: 'src/lib/planning/transfer.ts',
        formula:
          'osAvailable = max(0, byHub.osasco − Σ(yhat[1..osCoverage]×osShare)); proRata[spoke] = osAvailable × (spoke.need / totalNeed); qty = round(min(spoke.need, proRata)); descarta se qty<minQty',
        notes: "Excedente de Osasco distribuído entre mooca/sbc proporcional à falta. fromHub='osasco'.",
        ref: 'src/lib/planning/transfer.ts:106-141',
      },
      {
        name: 'Fallback spoke-to-spoke',
        source: 'src/lib/planning/transfer.ts',
        formula: 'spokeAvailable = max(0, byHub[fromSpoke] − Σ(yhat[1..coverage]×fromShare)); qty = round(min(toNeed.need, fromAvailable))',
        notes: 'Só quando Osasco indisponível (osAvailable<=0). Confiança menor (×0.7).',
        ref: 'src/lib/planning/transfer.ts:147-186',
      },
      {
        name: 'Confiança (frescor + incerteza de banda)',
        source: 'src/lib/planning/transfer.ts',
        formula:
          'freshness = clamp(1 − max(0, diffDays(asOfDate, today))/30, 0.3, 1); bandRel = média de (hi−lo)×share / max(yhat×share, 0.001); confidence = clamp((1 − bandRel/2) × freshness, 0.1, 0.95)',
        notes: 'Forecast >30d → freshness 0.3; alta variância → menor confiança. Spoke-to-spoke aplica ×0.7.',
        ref: 'src/lib/planning/transfer.ts:74-179',
      },
    ],
  },
  {
    title: 'Camada de aplicação',
    blurb:
      'Orquestração por request (carga + engines), filtro app-wide e cenário what-if, projeções single-SKU, e os helpers de formatação/labels/cores pt-BR usados nas páginas.',
    rows: [
      {
        name: 'loadPlanningInputs (orquestração)',
        source: 'src/lib/planning/load.ts — cookies + fetch paralelo de 8 fontes',
        formula:
          "cache(async (ignoreSkuSelection=false)): se backend==='none' → inputs vazios; senão Promise.all([stock, forecasts, shares, orders, alerts, compat, policies, recoveryRates]); aplica narrowFilter + cenário; buildPolicies",
        notes: 'React cache() → avaliação única por request. Filtro e cenário aplicados aqui. asOfDate = forecastBundle.asOfDate || today.',
        ref: 'src/lib/planning/load.ts:86-145',
      },
      {
        name: 'Filtro app-wide (PlanningFilter)',
        source: 'FILTER_COOKIE (vg:filter)',
        formula:
          'narrowFilter = ignoreSkuSelection ? {...filter, skus:[]} : filter; stocks = isFilterActive ? allStocks.filter(skuPasses) : allStocks',
        notes: 'Filtra por category, models, q (busca), skus (seleção manual). ignoreSkuSelection (SKUs/detalhe) ignora a seleção; demais páginas respeitam.',
        ref: 'src/lib/planning/load.ts:113-116',
      },
      {
        name: 'Cenário what-if (PlanningScenario)',
        source: 'SCENARIO_COOKIE (vg:scenario)',
        formula: 'se ativo: forecasts = scaleForecast(fc, demandPct); orders = delayOrder(o, poDelayDays); senão originais',
        notes: 'Simulação read-only: escala demanda % + atrasa PO. Aplicada uma vez; toda a app reflete sem tocar dados de produção.',
        ref: 'src/lib/planning/load.ts:120-126',
      },
      {
        name: 'computeSnapshot / safeComputeSnapshot',
        source: 'src/lib/planning/load.ts',
        formula:
          'computeSnapshot = cache(async): inp = loadPlanningInputs; purchases = purchaseForAll; transfers = transferForAll; return {...inp, purchases, transfers}. safe envolve em try/catch → empty + error',
        notes: 'Engine core: inputs → compras → transferências, cacheado por request. safe nunca lança; páginas renderizam shell + banner em falha.',
        ref: 'src/lib/planning/load.ts:152-194',
      },
      {
        name: 'projectOne / projectOneCompare',
        source: 'src/lib/planning/load.ts',
        formula:
          'projectOne(skuBase) → projectSku({stock, forecast, orders, policy, shares, today}). projectOneCompare: + baseline com {...policy, recoveryRate:0} quando isRepairable && recoveryRate>0',
        notes: 'baseline null se não-recuperável ou recovery 0% → overlay "sem recuperação" nos gráficos D-30→D+30 e D0→D+150.',
        ref: 'src/lib/planning/load.ts:196-244',
      },
      {
        name: 'SKU Table Row (página SKUs) — DOH',
        source: 'src/app/dashboard/skus/page.tsx',
        formula:
          'dailyDemand = leadTimeDays>0 ? expectedLeadTimeDemand/leadTimeDays : 0; dohDays = dailyDemand>0 ? round(onHand/dailyDemand) : null; sort por status depois nome',
        notes: 'safeComputeSnapshot(true): catálogo completo p/ check/uncheck. DOH = dias de cobertura derivado do lead time.',
        ref: 'src/app/dashboard/skus/page.tsx:15-41',
      },
      {
        name: 'Última atualização da recuperação (cron)',
        source: 'fleet.job_run (job_name=recovery-refresh)',
        formula: 'fetchRecoveryRefreshedAt() → last_run_at; cron /api/recovery/refresh roda semanalmente (seg 06:00 UTC)',
        notes: 'Exibido no RecoveryPanel. O cron re-deriva sku_policy.recovery_rate do ledger; preserva edições manuais (updated_by com email).',
        ref: 'src/lib/planning/recoveryRefresh.ts; vercel.json',
      },
      {
        name: 'Formatação pt-BR (números, moeda, datas)',
        source: 'src/lib/planning/format.ts',
        formula:
          "fmtInt/fmtNum/fmtBRL via Intl.NumberFormat('pt-BR'); fmtDate/fmtDateLong via DateTimeFormat('pt-BR', timeZone:'UTC'); null → '—'",
        notes: 'Inteiro sem casas; decimal default 1; BRL sem casas; datas UTC. Labels/classes de status/risco/severidade por mapa (tokens Vammo).',
        ref: 'src/lib/planning/format.ts:5-96',
      },
    ],
  },
];
