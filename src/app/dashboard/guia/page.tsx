import Link from 'next/link';
import { activeBackendKind } from '@/lib/clickhouse/reader';
import { fetchRecoveryRefreshedAt } from '@/lib/planning/recoveryRefresh';
import { fmtDateLong } from '@/lib/planning/format';
import { PageHeader } from '@/components/planning/ui';

export const dynamic = 'force-dynamic';

// Plain-language user guide: where the data comes from (ClickHouse — both the
// read-only analytics facts and the app-editable config tables, see decisions.MD
// #11), what is computed and the exact formulas, a glossary, and caveats. The
// technical counterpart is /dashboard/fontes (Fontes & Fórmulas).

export default async function GuiaPage() {
  const backend = activeBackendKind();
  const recoveryRefreshedAt = await fetchRecoveryRefreshedAt();
  const backendLabel = backend === 'clickhouse' ? 'ClickHouse (direto)' : 'Sem backend';

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Guia do usuário"
        title="Como o VammoGrid funciona"
        subtitle="De onde vêm os números, o que é calculado e com quais fórmulas — em linguagem simples. Para a referência técnica detalhada, veja Fontes & Fórmulas."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground">
          Fonte de dados atual: <span className="font-medium text-foreground">{backendLabel}</span>
        </span>
        {recoveryRefreshedAt && (
          <span className="rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground">
            Recuperação atualizada em{' '}
            <span className="font-medium text-foreground">{fmtDateLong(recoveryRefreshedAt.slice(0, 10))}</span>
          </span>
        )}
        <Link
          href="/dashboard/fontes"
          className="rounded-md bg-brand-500/15 px-2.5 py-1 font-medium text-brand-600 hover:bg-brand-500/25"
        >
          Ver versão técnica (Fontes & Fórmulas) →
        </Link>
      </div>

      {/* Em uma frase */}
      <Callout>
        O VammoGrid junta <b>dois tipos de dado</b>, os dois vivendo no mesmo data warehouse{' '}
        <b>ClickHouse</b> — o que <i>já aconteceu / está acontecendo</i> (fatos de analytics, somente leitura) e o
        que <i>as pessoas configuram no próprio app</i> (tabelas de configuração, editáveis, com histórico de
        alterações) — e em cima disso <b>calcula</b> projeções de estoque, sugestões de compra e de transferência.
        O app <b>não inventa demanda</b>: consome uma previsão pronta (S&amp;OP) e faz contas determinísticas
        (mesma entrada → mesmo resultado).
      </Callout>

      {/* 1. Fontes */}
      <Section n="1" title="De onde vêm os dados">
        <div className="grid gap-4 md:grid-cols-2">
          <SourceCard
            tag="ClickHouse · Fatos"
            tagClass="bg-brand-500/15 text-brand-600"
            subtitle="O “retrato da realidade” — o app só lê, nunca grava"
            items={[
              ['Estoque atual por hub', 'Quantas peças há hoje em Osasco, Mooca e SBC. Conta só o disponível e em prateleira de estoque (ignora instaladas/reservadas).'],
              ['Previsão de demanda (S&OP)', 'Quanto se espera consumir por dia de cada peça. O app só usa; quem gera é o modelo do time de S&OP.'],
              ['Histórico de estoque', 'Quanto havia em estoque a cada dia (últimos ~30 dias) — a parte do gráfico “antes de hoje”.'],
              ['Movimentações (ledger)', 'O “extrato” do estoque: consumo e recuperação (recondicionamento). Daí saem a taxa real de recuperação e a divisão de demanda entre hubs.'],
              ['Alertas e catálogo/preços', 'Alertas de cobertura do S&OP e o preço unitário de catálogo (usado no custo estimado).'],
            ]}
          />
          <SourceCard
            tag="ClickHouse · Config"
            tagClass="bg-alert-success/15 text-alert-success"
            subtitle="Os dados do próprio app — editáveis pelas pessoas, com log de alterações"
            items={[
              ['Pedidos de compra (VOs)', 'Pedidos em aberto: data, ETA, modal (marítimo/aéreo), quantidade. Sincronizados do ClickHouse (dev.vmoto_orders) ou adicionados manualmente.'],
              ['Parâmetros por SKU', 'Lead time marítimo/aéreo + modal padrão, taxa de recuperação + turnaround, e estoque de segurança. Cada ajuste vale para a empresa toda naquele SKU.'],
              ['Snapshots e jobs', 'Foto diária por hub e o registro das rotinas automáticas (ex.: quando a recuperação foi atualizada).'],
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Tudo é casado pelo <b>código do SKU (sku_base)</b>, nunca pelo nome — porque os nomes divergem entre sistemas.
        </p>
      </Section>

      {/* 2. Cálculos + fórmulas */}
      <Section n="2" title="O que é calculado — e com quais fórmulas">
        <Calc
          title="Cobertura (DOH — dias de estoque)"
          plain="Quantos dias o estoque atual dura no ritmo de consumo."
          formula="DOH = estoque atual ÷ consumo médio diário (média dos próximos 30 dias)"
        />
        <Calc
          title="Projeção de estoque (até 150 dias)"
          plain="Começa no estoque de hoje e caminha dia a dia. Mostra também uma faixa otimista/pessimista a partir da banda da previsão."
          formula={[
            'estoque(d) = estoque(d−1) − demanda(d) + chegadas(d) + recuperação(d)   (nunca abaixo de 0)',
            'faixa: cenário otimista usa demanda baixa; pessimista usa demanda alta',
          ]}
        />
        <Calc
          title="Recuperação (peças recondicionadas)"
          plain="Uma fração do que foi consumido volta ao estoque depois do tempo de reparo (turnaround). É creditada em Osasco (e no total da rede)."
          formula="recuperação(d) = taxa de recuperação × demanda(d − turnaround)"
          note="Taxa observada (IMS) = recondicionados ÷ consumidos nos últimos 90 dias. O cron semanal grava essa taxa; valores acima de 100% (ruído) viram 0."
        />
        <Calc
          title="Ruptura"
          plain="A data em que a projeção zera o estoque."
          formula="ruptura = primeiro dia em que estoque(d) ≤ 0"
        />

        <h4 className="mt-6 mb-2 text-sm font-bold text-foreground">Recomendação de compra (política s,S)</h4>
        <Calc
          title="Estoque mínimo (demanda no lead time)"
          plain="Quanto se espera consumir enquanto o pedido não chega (lead time L, padrão 110 dias). É o piso para aguentar a reposição — sem nenhum colchão."
          formula="estoque mínimo = soma da previsão (yhat) do dia 1 até o dia L"
        />
        <Calc
          title="Incerteza do consumo (σ mensal e σ_L)"
          plain="A “margem de erro” do consumo. Parte do desvio-padrão do consumo dos próximos 30 dias (σ mensal, tirado da banda da previsão) e escala para o lead time pela raiz do lead em meses — dias tratados como independentes (propagação de erro), não somando a banda dia a dia."
          formula={[
            'σ_d (diário) = ( previsão_alta(d) − yhat(d) ) ÷ 1,28',
            'σ_mês = √( soma dos σ_d² nos próximos 30 dias )',
            'σ_L = σ_mês × √( lead time ÷ 30 )        (lead em meses)',
          ]}
        />
        <Calc
          title="Estoque de segurança (SS)"
          plain="Colchão que absorve a variabilidade do CONSUMO no lead time. Quanto mais crítica a peça (classe A>B>C) e maior a incerteza, maior. Pode ser fixado manualmente por SKU."
          formula="SS = Z(classe) × σ_mês × √(lead em meses)   —  Z: A=1,96 · B=1,65 · C=1,28   (ou override manual)"
        />
        <Calc
          title="Ponto de recompra (ROP)"
          plain="Estoque mínimo + colchão de segurança. Quando o estoque cai abaixo disto, é hora de comprar."
          formula="ROP = estoque mínimo + SS"
        />
        <Calc
          title="Nível-alvo e quanto comprar"
          plain="Repõe até cobrir o lead time mais um alvo de dias de cobertura (DOI), descontando o que já está a caminho."
          formula={[
            'nível-alvo (S) = soma da previsão até (L + DOI_alvo) + SS    —  DOI: A=30 · B=45 · C=60 dias',
            'comprar (Q) = máx(0, S − estoque − pedidos a caminho)   — só quando estoque ≤ ROP',
          ]}
        />
        <Calc
          title="Comprar até / custo"
          plain="A data-limite para o pedido chegar antes da ruptura, e o custo estimado."
          formula={[
            'comprar até = data de ruptura − L     (se já passou → comprar JÁ / expedir aéreo)',
            'custo estimado = Q × preço unitário (catálogo IMS)',
          ]}
        />

        <h4 className="mt-6 mb-2 text-sm font-bold text-foreground">Transferências entre hubs (2 ciclos semanais)</h4>
        <Calc
          title="Demanda por hub"
          plain="A previsão é da rede toda; ela é dividida entre hubs pela fatia de consumo de cada um."
          formula={[
            'fatia do hub = consumo do hub ÷ consumo total (últimos 30 dias)',
            'demanda do hub no ciclo = soma da previsão na janela × fatia do hub   (janela = 7 dias + trânsito: Mooca +1, SBC +2)',
          ]}
        />
        <Calc
          title="Falta, sobra e sugestão"
          plain="Se um hub vai faltar e Osasco tem sobra acima do próprio colchão, sugere mover (rateado pela falta). O Ciclo 2 parte do estoque já projetado após o Ciclo 1."
          formula={[
            'falta do hub = máx(0, demanda no ciclo − estoque do hub)',
            'sobra de Osasco = máx(0, estoque Osasco − demanda de Osasco no ciclo)',
            'transferir = mín(falta do hub, parte proporcional da sobra de Osasco)',
          ]}
          note="Cada sugestão também ganha uma Confiança (0–100%) — veja abaixo."
        />
        <Calc
          title="Confiança da transferência"
          plain="Quanto confiar na sugestão. Combina a precisão da previsão na janela (quão estreita é a banda em relação à demanda acumulada) com o frescor dos dados (há quantos dias a previsão foi gerada). É exibida como “prec X% · fresc Y%” na coluna Confiança."
          formula={[
            'cv = (banda acumulada na janela ÷ 1,28) ÷ demanda acumulada na janela',
            'precisão = 1 ÷ (1 + cv)            (cv 0 → 100% · cv 1 → 50% · cv 3 → 25%)',
            'frescor = limita(1 − dias_desatualizado ÷ 30, entre 30% e 100%)',
            'confiança = limita(precisão × frescor, entre 5% e 95%)',
          ]}
          note="Usa a demanda ACUMULADA da janela (não o dia-a-dia, que dispara em peças de baixo volume e prendia tudo perto de 10%). O fallback spoke-to-spoke aplica ×0,7. Não é probabilidade de ruptura — é um índice de confiança."
        />
        <Calc
          title="Grade semanal (Semanas)"
          plain="Pega a projeção e mostra, semana a semana (8 semanas), o estoque e a cobertura de cada SKU, coloridos por risco."
          formula="cada célula = projeção no fim da semana → vermelho (ruptura) · amarelo (cobertura < 14d) · verde (chegada de pedido)"
        />

        <h4 className="mt-6 mb-2 text-sm font-bold text-foreground">Lead time por modal</h4>
        <Calc
          title="Lead time efetivo"
          plain="Cada SKU tem um lead marítimo e um aéreo; o modal padrão define qual é usado nas contas de compra."
          formula="lead efetivo = (modal padrão = aéreo) ? lead aéreo : lead marítimo    — padrão internacional: 110d marítimo / 40d aéreo; nacionais vêm da planilha-semente"
        />
      </Section>

      {/* 3. Fluxo */}
      <Section n="3" title="Como tudo se conecta">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FlowBox>Fontes<br /><span className="text-[11px] text-muted-foreground">ClickHouse (fatos + config)</span></FlowBox>
          <span className="text-muted-foreground">→</span>
          <FlowBox>Cenário do dia<br /><span className="text-[11px] text-muted-foreground">filtros + simulações</span></FlowBox>
          <span className="text-muted-foreground">→</span>
          <FlowBox>Motores de cálculo<br /><span className="text-[11px] text-muted-foreground">projeção · compras · transferências</span></FlowBox>
          <span className="text-muted-foreground">→</span>
          <FlowBox>Telas<br /><span className="text-[11px] text-muted-foreground">Estoque · Compras · Semanas · …</span></FlowBox>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Os filtros no topo (Moto/Bateria, modelos, “com previsão”, SKUs selecionados) e o modo cenário (demanda %, atraso
          de pedidos) afetam <b>todas as telas ao mesmo tempo</b> — sem alterar nenhum dado de produção.
        </p>
      </Section>

      {/* 4. Glossário */}
      <Section n="4" title="Glossário rápido">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Term t="SKU / sku_base">Código que identifica a peça. O app agrupa as variantes pelo código “base” (4 primeiros blocos).</Term>
          <Term t="Hub">Centro de estoque: Osasco (central + recuperação), Mooca, SBC.</Term>
          <Term t="DOH / cobertura">Dias que o estoque dura no ritmo atual de consumo.</Term>
          <Term t="Lead time (L)">Dias entre pedir e a peça chegar.</Term>
          <Term t="ROP">Ponto de recompra = estoque mínimo + segurança — gatilho para comprar.</Term>
          <Term t="Estoque mínimo">Consumo previsto durante o lead time — o piso sem colchão.</Term>
          <Term t="Estoque de segurança (SS)">Colchão sobre o mínimo: Z × σ_mês × √(lead em meses).</Term>
          <Term t="σ mensal / σ_L">Desvio-padrão do consumo em 30 dias / ao longo do lead time.</Term>
          <Term t="Classe ABC">Importância da peça (A mais crítica). Define o nível de serviço (Z) e a cobertura-alvo (DOI).</Term>
          <Term t="yhat / banda (lo–hi)">Previsão central de consumo e seu intervalo otimista–pessimista.</Term>
          <Term t="VO / pedido">Ordem de compra em aberto.</Term>
        </dl>
      </Section>

      {/* 5. Pontos de atenção */}
      <Section n="5" title="Pontos de atenção">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• <b>A previsão é semanal e pode estar alguns dias defasada</b> — as contas valem o quanto vale a previsão mais recente.</li>
          <li>• <b>Preços vêm do catálogo do IMS e podem ser genéricos</b> (vários itens com o mesmo valor) — o custo estimado é uma aproximação.</li>
          <li>• <b>Nomes de peça divergem entre sistemas</b>; por isso tudo casa pelo código (sku_base), não pelo nome.</li>
          <li>• <b>Nem toda peça prevista está no seu estoque</b>: parte das previsões usa códigos de outras gerações/fornecedor que não estão no catálogo atual do IMS.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2 border-b border-foreground/10 pb-2">
        <span className="font-mono text-xs text-muted-foreground/60">{n}</span>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-8 rounded-xl bg-brand-500/[0.06] p-4 text-sm leading-relaxed text-foreground/90 ring-1 ring-brand-500/20">
      {children}
    </div>
  );
}

function SourceCard({
  tag,
  tagClass,
  subtitle,
  items,
}: {
  tag: string;
  tagClass: string;
  subtitle: string;
  items: [string, string][];
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${tagClass}`}>{tag}</span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
      <ul className="space-y-2.5">
        {items.map(([k, v]) => (
          <li key={k}>
            <p className="text-sm font-semibold text-foreground">{k}</p>
            <p className="text-xs text-muted-foreground">{v}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Calc({
  title,
  plain,
  formula,
  note,
}: {
  title: string;
  plain: string;
  formula: string | string[];
  note?: string;
}) {
  const lines = Array.isArray(formula) ? formula : [formula];
  return (
    <div className="mb-3 rounded-lg border border-border bg-card/40 p-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{plain}</p>
      <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-3 py-2">
        {lines.map((l, i) => (
          <p key={i} className="font-mono text-[11px] leading-relaxed text-foreground/90">
            {l}
          </p>
        ))}
      </div>
      {note && <p className="mt-1.5 text-[11px] text-muted-foreground">ℹ {note}</p>}
    </div>
  );
}

function FlowBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-muted/40 px-3 py-2 text-center text-xs font-semibold text-foreground">{children}</div>;
}

function Term({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-foreground">{t}</dt>
      <dd className="text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}
