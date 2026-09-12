// api/_cadeia-lib.js — mecanismo genérico de avanço e timeout para CADEIAS de handoff entre
// agentes (encomenda: "Handoff entre agentes — fechar a cadeia", 11/set/2026).
//
// ORIGEM: o inventário dos 8 agentes (04-11/set/2026) provou que a cadeia `novo_criativo_ads`
// (Tráfego → Estratégia → Criativo → [devolveria ao Tráfego]) nunca fecha o 3º elo. Causa: o
// avanço só existia hardcoded em api/agente-chat.js, pro caso "Estratégia conclui pelo chat" —
// nunca foi estendido pro worker (api/cron.js), que é quem de fato conclui o elo 2. Relatório
// completo, com as citações de código, em APRENDIZADOS.md "Handoff entre agentes — fechar a
// cadeia". Este módulo é a fundação genérica pedida — não implementa nenhuma cadeia nova.
//
// ───────────────────────────────────────────────────────────────────────────────────────────
// CONTRATO DO PAYLOAD DE UMA ORDEM QUE FAZ PARTE DE UMA CADEIA (ordens sem isso NUNCA são
// tocadas por este módulo — o caminho de ordem avulsa comum passa incólume):
//
//   payload.cadeia            [{ agente, tarefa, tipo:'executa'|'retorno' }, ...] — descrita por
//                              INTEIRO no nascimento da cadeia (nunca inferida/recalculada no
//                              meio do caminho). O último elo, tipo:'retorno', fecha o loop de
//                              volta a quem pediu — mesmo mecanismo genérico pra qualquer cadeia,
//                              sem código específico por caso (item 5 do pedido).
//   payload.elo                índice (0-based) do elo ATUAL dentro de payload.cadeia.
//   payload.cadeia_iniciada_em ISO — gravado 1x, na criação do elo 0. Base do PRAZO TOTAL da
//                              cadeia (3º relógio, item 1.2b) — nunca created_at (esse é só da
//                              ordem, não da cadeia) nem concluida_em (tem bug conhecido de ficar
//                              nulo quando `estadoFinal==='concluida'` mas `feitos===0` — ver
//                              jobProduzir, api/cron.js linha ~741/749 — por isso este módulo
//                              nunca depende de concluida_em pra nada).
//   payload.elo_iniciado_em    ISO — gravado pelo PRÓPRIO CÓDIGO, no exato instante em que o elo
//                              é criado (nunca lido de volta do banco depois). Base do TIMEOUT DE
//                              PASSAGEM (item 1.2a). Ordens fora de cadeia nunca ganham este campo.
//   payload.resultado_etapas   [{ agente, tarefa, tipo, tipo_valor, valor, em }, ...] — acumulado
//                              a cada elo concluído. `valor` é SEMPRE uma REFERÊNCIA (id de
//                              conteudos, URL de arquivo já salvo) — nunca copy inteira, nunca
//                              base64, nunca texto longo (item 1.3).
//   payload.avisos             [{ em, motivo }] — 1º estouro de passagem, NÃO terminal (item 2.2).
//
// ARGUMENTO `resultadoElo` de avancarCadeia — { tipo, valor, payloadExtra? }: `tipo`/`valor` vão
// pra resultado_etapas (histórico/referência, nunca conteúdo — item 1.3). `payloadExtra` (12/set/
// 2026, handoff Criativo→Estratégia) é OPCIONAL e é diferente: é o dado OPERACIONAL que o PRÓXIMO
// elo precisa pra o worker rodar (ex.: `{ids:[novoConteudoId]}` quando o elo que fechou criou um
// conteúdo que só passa a existir depois de rodar — não podia estar em payload.cadeia, decidido
// no nascimento). Mesclado no payload do próximo elo; nunca vai pro histórico de resultado_etapas.
//
// COMPATIBILIDADE COM O FORMATO ANTIGO (payload.sequencia + payload.etapa, único uso real: a
// `novo_criativo_ads` já em voo antes deste deploy): `avancarCadeia` lê os dois formatos — ver
// `normalizarCadeia` abaixo. `verificarTimeoutCadeia` só enxerga o formato novo (payload.cadeia);
// uma ordem antiga em voo passa a ser coberta pelo timeout a partir do PRÓXIMO elo que ela gerar
// (que já nasce no formato novo). PRAZO PARA REMOÇÃO DESTA PONTE: condicional, não uma data fixa
// — remover quando a consulta abaixo (rodada por quem tem acesso ao banco; este ambiente não tem
// credencial de produção) retornar zero linhas:
//   select count(*) from ordens_servico where status in ('pendente','processando',
//   'aguardando_aprovacao') and payload ? 'sequencia' and not (payload ? 'cadeia');
//
// GARANTIAS (o que este módulo NUNCA faz):
//   - nunca mexe em ordem sem payload.cadeia (nem formato novo, nem `sequencia` antigo).
//   - nunca cria o próximo elo sem checar antes se ele já existe — idempotência por `ordem_pai`
//     (item 1.1; ver `avancarCadeia`, "IDEMPOTÊNCIA" abaixo, pro porquê da chave escolhida e por
//     que NÃO reaproveita `ordem_itens`/Lote 1).
//   - ao falhar, NUNCA desfaz nem apaga `resultado_etapas` ou `payload.cadeia` da ordem que já
//     falhou — a cadeia PARA no elo problemático, preserva tudo que já foi produzido antes
//     (item 1.4). Retomar a partir do ponto de falha NÃO está implementado nesta rodada — mas
//     nada aqui impede: `resultado_etapas`/`cadeia`/`elo` continuam intactos na ordem 'erro'.

const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY;
const H = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' });

// TRÊS RELÓGIOS (item 1.2). Os dois primeiros JÁ EXISTEM e não mudam aqui — watchdog (8min,
// jobOrdens) e resgate de órfã (1h, jobOrdens) cobrem "elo TRAVOU trabalhando" (status=processando
// sem heartbeat). O que faltava é o terceiro: quanto pode durar a TRANSIÇÃO entre elos (elo
// concluiu, o próximo ainda não começou a rodar) e quanto pode durar a CADEIA INTEIRA.
const TIMEOUT_PASSAGEM_MS = 2 * 60 * 1000; // 2min — especificado no pedido (item 2). Só a transição.
// 6min: api/gerar-imagem.js tem maxDuration:300s (vercel.json) — teto duro da função; "ordens de
// produção concluem em 5 a 6 minutos" é o tempo real observado (João, 11/set/2026). Uma margem
// pequena acima do teto da função, não um número arbitrário.
const TEMPO_MAX_EXECUCAO_ELO_MS = 6 * 60 * 1000;
// PRAZO TOTAL POR FÓRMULA, não por número fixo — vale pra qualquer cadeia futura, mais longa ou
// mais curta, sem editar isto de novo (item 1: "vale para qualquer cadeia, não só para esta").
// Cadeia de 3 elos (novo_criativo_ads): 3×6 + 2×2 = 22min.
function prazoTotalCadeiaMs(cadeia) {
  const n = Array.isArray(cadeia) && cadeia.length ? cadeia.length : 1;
  return n * TEMPO_MAX_EXECUCAO_ELO_MS + Math.max(0, n - 1) * TIMEOUT_PASSAGEM_MS;
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H() }).catch(() => null);
  if (!r) return [];
  const j = await r.json().catch(() => []);
  if (!r.ok) { console.error('[cadeia-lib] sbGet falhou — path=' + path + ' status=' + r.status); return []; }
  return Array.isArray(j) ? j : [];
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) }).catch(() => null);
  if (r && !r.ok) {
    let motivo = ''; try { const j = await r.json(); motivo = j.message || j.hint || j.details || JSON.stringify(j).slice(0, 200); } catch (e) {}
    console.error('[cadeia-lib] sbPatch falhou — path=' + path + ' status=' + r.status + ' motivo=' + String(motivo).slice(0, 200));
  }
  return r;
}
async function sbInsert(body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, { method: 'POST', headers: H(), body: JSON.stringify(body) }).catch(() => null);
  if (r && !r.ok) {
    let motivo = ''; try { const j = await r.json(); motivo = j.message || j.hint || j.details || JSON.stringify(j).slice(0, 200); } catch (e) {}
    console.error('[cadeia-lib] sbInsert (próximo elo) falhou — status=' + r.status + ' motivo=' + String(motivo).slice(0, 200));
  }
  return r;
}
// Mesma fórmula já usada em api/cron.js:571 e api/agente-chat.js:1327 (SITE_URL > VERCEL_URL).
// Não foi possível importar de lá sem tocar nessas funções (protegidas nesta rodada) — replicada
// aqui de propósito, não divergente. Se um dia consolidar as 3 cópias, ESTA é a 3ª, não a 1ª.
function siteBase() {
  return String(process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/+$/, '');
}
function autodisparar() {
  const b = siteBase();
  if (b && process.env.CRON_SECRET) fetch(`${b}/api/cron?job=produzir&secret=${process.env.CRON_SECRET}`, { method: 'POST' }).catch(() => {});
}

// PONTE COM O FORMATO ANTIGO (ver "COMPATIBILIDADE" no topo do arquivo). Só existe pra
// `novo_criativo_ads` já em voo — é o único lugar do código que já usou `sequencia`/`etapa`.
function normalizarCadeia(pl) {
  if (Array.isArray(pl.cadeia) && pl.cadeia.length) {
    return { cadeia: pl.cadeia, elo: Number(pl.elo != null ? pl.elo : 0), formatoAntigo: false };
  }
  if (Array.isArray(pl.sequencia) && pl.sequencia.length) {
    const cadeia = pl.sequencia.map((agente, i) => ({
      agente,
      tarefa: i === 0 ? 'novo_criativo_ads' : 'criar_criativo_ads',
      tipo: i === pl.sequencia.length - 1 ? 'retorno' : 'executa',
    }));
    return { cadeia, elo: Number(pl.etapa != null ? pl.etapa : 0), formatoAntigo: true };
  }
  return { cadeia: null, elo: 0, formatoAntigo: false };
}

// avancarCadeia — chamada nos pontos onde uma ordem que faz parte de uma cadeia ACABOU de
// concluir seu elo (a ordem já deve estar 'concluida' no banco antes desta chamada; esta função
// não fecha o elo atual, só decide e cria o que vem depois).
//
//   ordemFechada: { id, user_id, detalhe, payload } — a ordem que fechou.
//   resultadoElo: { tipo, valor } — o que ESTE elo produziu. `valor` é sempre referência
//                 (id de conteudos, URL de arquivo) — nunca conteúdo bruto (item 1.3).
async function avancarCadeia(ordemFechada, resultadoElo) {
  const pl = (ordemFechada && ordemFechada.payload) || {};
  const norm = normalizarCadeia(pl);
  if (!norm.cadeia) return { avancou: false, motivo: 'sem cadeia' }; // ordem comum — nunca tocada

  // IDEMPOTÊNCIA (item 1.1) — prioridade máxima. "Verificar antes de agir": entrega ao menos
  // uma vez, nunca exatamente uma vez (retry, chamada concorrente, reprocessamento após falha
  // parcial podem invocar isto 2x pra ELO igual). Chave escolhida: `ordem_pai` = id da ordem que
  // está fechando — um elo só pode gerar UM próximo elo, então "já existe ordem com esse
  // ordem_pai" é suficiente e não precisa de coluna nova nem de filtro em campo jsonb (que este
  // código nunca usou em consulta REST até hoje — só em trigger SQL). NÃO reaproveita a trava de
  // `ordem_itens`/Lote 1 (índice único parcial sobre conteúdo, `ux_ordem_itens_ativo`): aquela
  // trigger só marca `ativo` pra tarefa IN ('criar_post','criar_avulso') com `payload.ids`
  // presente — nenhuma tarefa de cadeia (`criar_criativo_ads`, o novo `retorno_criativo_ads`)
  // entra nesse IN, e o dedup de cadeia é por ELO/ordem_pai, não por conteúdo. Estender aquela
  // trigger pra cobrir isto tocaria numa trava do Lote 1 (fora do escopo autorizado: "não
  // alterar... travas de duplicidade do Lote 1") e resolveria uma pergunta diferente da que
  // precisa ser respondida aqui. Por isso: mecanismo próprio, deliberadamente mais simples.
  const existentes = await sbGet(`ordens_servico?ordem_pai=eq.${ordemFechada.id}&select=id&limit=1`);
  if (existentes.length) {
    return { avancou: false, motivo: 'próximo elo já existe (idempotência) — ordem_pai=' + ordemFechada.id, idFilho: existentes[0].id };
  }

  const etapasAnteriores = Array.isArray(pl.resultado_etapas) ? pl.resultado_etapas : [];
  const eloAtual = norm.cadeia[norm.elo] || {};
  const novaEtapa = {
    agente: eloAtual.agente || null, tarefa: eloAtual.tarefa || null, tipo: eloAtual.tipo || 'executa',
    tipo_valor: (resultadoElo && resultadoElo.tipo) || null, valor: (resultadoElo && resultadoElo.valor) || null,
    em: new Date().toISOString(),
  };
  const resultadoEtapas = [...etapasAnteriores, novaEtapa];
  const proximoIdx = norm.elo + 1;
  const proximo = norm.cadeia[proximoIdx];

  if (!proximo) {
    // FECHAMENTO EXPLÍCITO (item 1): não há próximo elo — a cadeia termina aqui. A ordem que
    // fechou já está 'concluida' (quem chamou já gravou isso); só garante que resultado_etapas
    // não se perde no último elo.
    await sbPatch(`ordens_servico?id=eq.${ordemFechada.id}`, { payload: { ...pl, resultado_etapas: resultadoEtapas } });
    return { avancou: false, motivo: 'cadeia concluída — sem próximo elo', resultadoEtapas };
  }

  const agora = new Date().toISOString();
  // AVANÇO AUTOMÁTICO ENTRE ELOS (item 4): por código, aqui, sem depender de nenhum agente
  // lembrar de emitir tag — este é o único lugar que decide o próximo elo.
  // CHAMADA DE RETORNO (item 5): elo tipo:'retorno' fecha o loop de volta a quem pediu — nasce
  // JÁ 'concluida' (é uma notícia de fechamento, não um trabalho a executar), com
  // resultado_etapas completo. Mesmo mecanismo pra qualquer cadeia futura que queira voltar à
  // origem, sem código por caso.
  const ehRetorno = proximo.tipo === 'retorno';
  // MIGRAÇÃO DE FORMATO NA PASSAGEM (item 1.5): a ordem nova sempre nasce no formato NOVO
  // (payload.cadeia), mesmo quando a que está fechando ainda era do formato antigo
  // (payload.sequencia/etapa) — sequencia/etapa NUNCA são repropagados adiante. É assim que uma
  // cadeia antiga em voo "gradua" pro formato novo a partir do seu próximo elo (e passa a ser
  // coberta pelo timeout de passagem a partir daí — verificarTimeoutCadeia só reconhece
  // payload.cadeia). Exceção: cadeia_iniciada_em de uma cadeia que nasceu no formato antigo não
  // existe (o formato antigo nunca gravou isso) — não dá pra recuperar o instante real de início,
  // então o prazo TOTAL da cadeia fica sem checagem pra essas (verificarTimeoutCadeia já trata
  // isso de forma explícita, não silenciosa); o timeout de PASSAGEM funciona normalmente.
  const { sequencia, etapa, ...plSemFormatoAntigo } = pl;
  const corpo = {
    user_id: ordemFechada.user_id,
    de_agente: eloAtual.agente || null,
    para_agente: proximo.agente,
    tarefa: proximo.tarefa,
    detalhe: pl.brief || ordemFechada.detalhe || '',
    status: ehRetorno ? 'concluida' : 'pendente',
    ordem_pai: ordemFechada.id,
    total: 1, progresso: ehRetorno ? 1 : 0,
    ...(ehRetorno ? { concluida_em: agora } : {}),
    // payloadExtra (12/set/2026, handoff Criativo→Estratégia): campo OPCIONAL em resultadoElo —
    // dado OPERACIONAL que o próximo elo precisa pra o WORKER processar (ex.: payload.ids
    // apontando pro conteúdo que a Estratégia acabou de gravar, que só passa a existir DEPOIS do
    // elo atual — não dá pra estar em payload.cadeia, decidido no nascimento da cadeia). Nunca
    // confundir com resultado_etapas: aquele é histórico/auditoria (referência, item 1.3);
    // payloadExtra é o dado que o PRÓXIMO elo de fato consome pra rodar.
    payload: { ...plSemFormatoAntigo, ...((resultadoElo && resultadoElo.payloadExtra) || {}), cadeia: norm.cadeia, elo: proximoIdx, resultado_etapas: resultadoEtapas, elo_iniciado_em: agora },
  };
  const r = await sbInsert(corpo);
  const d = r && r.ok ? await r.json().catch(() => null) : null;
  if (!ehRetorno) {
    // Sem isto, o próximo elo só seria pego na próxima janela de 5min do cron — insuficiente pro
    // limite de passagem de 2min ter sentido (item 1.2a + Parte 2.1 do pedido).
    autodisparar();
  }
  return { avancou: true, proximoAgente: proximo.agente, proximaTarefa: proximo.tarefa, retorno: ehRetorno, idProximo: Array.isArray(d) && d[0] ? d[0].id : null };
}

// verificarTimeoutCadeia — chamada como passo IRMÃO do job `produzir` (não dentro de
// jobProduzir()): varre ordens 'pendente' que nasceram de um avanço de cadeia (payload.cadeia +
// payload.elo_iniciado_em — só o formato NOVO; ver "COMPATIBILIDADE" no topo pro porquê de ordens
// em formato antigo não entrarem aqui) e aplica os dois limites (passagem + prazo total).
//
// Busca TODAS as 'pendente' (sem filtro por campo jsonb na query REST — este código nunca usou
// esse filtro antes; o filtro por payload.cadeia/elo_iniciado_em é feito aqui em JS, auditável e
// sem depender de sintaxe não testada neste ambiente) e filtra em memória — volume baixo o
// bastante (mesma ordem de grandeza dos outros `limit=` deste projeto) pra não pesar.
async function verificarTimeoutCadeia() {
  const candidatas = await sbGet('ordens_servico?status=eq.pendente&select=id,user_id,payload,created_at&limit=500');
  let avisos = 0, errosPassagem = 0, errosPrazoTotal = 0;
  const agora = Date.now();

  for (const o of candidatas) {
    const pl = o.payload || {};
    if (!Array.isArray(pl.cadeia) || !pl.cadeia.length) continue; // sem cadeia (ou formato antigo) — não é candidata

    // PRAZO TOTAL DA CADEIA (item 1.2b) — independente de qual elo está ativo.
    const inicioCadeiaMs = pl.cadeia_iniciada_em ? new Date(pl.cadeia_iniciada_em).getTime() : NaN;
    if (!inicioCadeiaMs || Number.isNaN(inicioCadeiaMs)) {
      // Parte 2.3: nunca presumir. Sem marca confiável pro prazo total, registra o fato e PULA
      // só essa checagem (a de passagem, abaixo, continua valendo — ela tem sua própria base).
      console.error('[cadeia-lib] cadeia_iniciada_em ausente/inválido — prazo total não verificado — ordem=' + o.id);
    } else {
      const prazoTotal = prazoTotalCadeiaMs(pl.cadeia);
      if (agora - inicioCadeiaMs > prazoTotal) {
        const eloNome = (pl.cadeia[pl.elo] || {}).agente || '?';
        await sbPatch(`ordens_servico?id=eq.${o.id}`, {
          status: 'erro',
          payload: { ...pl, erros: [{ tema: 'cadeia', motivo: `Cadeia de ${pl.cadeia.length} elo(s) excedeu o prazo total de ${Math.round(prazoTotal / 60000)}min (início ${pl.cadeia_iniciada_em}) — parada no elo ${pl.elo} (${eloNome}), detectado às ${new Date(agora).toISOString()}.` }] },
        });
        errosPrazoTotal++;
        continue; // já virou erro por prazo total — não checa passagem em cima do que acabou de falhar
      }
    }

    // TIMEOUT DE PASSAGEM (item 1.2a) — só a transição entre elos, nunca o tempo de execução
    // (isso continua sendo watchdog/resgate-de-órfã, intocados, em jobOrdens).
    let marcaMs = pl.elo_iniciado_em ? new Date(pl.elo_iniciado_em).getTime() : NaN;
    let baseFallback = false;
    if (!marcaMs || Number.isNaN(marcaMs)) {
      // Não deveria acontecer pra formato novo (este código sempre grava elo_iniciado_em ao
      // criar) — defesa explícita mesmo assim, nunca silenciosa (item 2.3).
      marcaMs = new Date(o.created_at).getTime();
      baseFallback = true;
      console.error('[cadeia-lib] elo_iniciado_em ausente numa ordem com payload.cadeia — usando created_at como base — ordem=' + o.id);
    }
    const decorridoMs = agora - marcaMs;
    if (decorridoMs <= TIMEOUT_PASSAGEM_MS) continue; // dentro do limite

    const eloNome = (pl.cadeia[pl.elo] || {}).agente || '?';
    const estourouEm = new Date(marcaMs + TIMEOUT_PASSAGEM_MS).toISOString();
    const detectadoEm = new Date(agora).toISOString();

    if (!Array.isArray(pl.avisos) || !pl.avisos.length) {
      // Parte 2.2 — 1º estouro NÃO é terminal: fila ocupada (worker processa em lote de 3, série,
      // Parte 2.1) pode legitimamente atrasar sem que nada esteja travado. Fica 'pendente',
      // continua elegível pro worker pegar a qualquer momento — só grava um aviso visível.
      await sbPatch(`ordens_servico?id=eq.${o.id}`, {
        payload: { ...pl, avisos: [{ em: detectadoEm, motivo: `Elo ${pl.elo} (${eloNome}) não iniciou em até 2min após o elo anterior concluir — estourou às ${estourouEm}, detectado às ${detectadoEm}${baseFallback ? ' (base: created_at, sem elo_iniciado_em)' : ''}.` }] },
      });
      avisos++;
      continue;
    }

    // 2º estouro consecutivo (já havia aviso e continua pendente) — erro terminal.
    await sbPatch(`ordens_servico?id=eq.${o.id}`, {
      status: 'erro',
      payload: { ...pl, erros: [{ tema: 'passagem', motivo: `Elo ${pl.elo} (${eloNome}) não iniciou mesmo após aviso — 2º estouro de passagem de 2min. Parado desde ${pl.elo_iniciado_em || o.created_at}, detectado às ${detectadoEm}.` }] },
    });
    errosPassagem++;
  }

  return { candidatas: candidatas.length, avisos_passagem: avisos, erros_passagem: errosPassagem, erros_prazo_total: errosPrazoTotal };
}

module.exports = { avancarCadeia, verificarTimeoutCadeia, normalizarCadeia, prazoTotalCadeiaMs, TIMEOUT_PASSAGEM_MS, TEMPO_MAX_EXECUCAO_ELO_MS };
