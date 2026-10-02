// api/_ads-lib.js — Leitura da Meta Marketing API (Agente de Tráfego, FASE 1 — só leitura, 02/out/2026)
//
// REGRA DE RESPONSABILIDADE (decisão do João, 02/out/2026): o JUMP nunca ativa campanha, nunca
// mexe em orçamento e nunca exclui nada na conta de anúncios do cliente. Esta lib, de propósito,
// só tem funções de LEITURA (GET). A fase 2 (montar estrutura PAUSADA no orçamento mínimo) vai
// entrar como função própria, que força status PAUSED em código — nunca por instrução em texto.
//
// Token: login do Facebook (graph.facebook.com), NÃO o login do Instagram — a Marketing API não
// aceita token do Instagram Business Login. Toda chamada leva appsecret_proof (HMAC do token com
// META_APP_SECRET), exigido quando "Exigir chave secreta do app" está ligado no painel da Meta.
const crypto = require('crypto');

const GRAPH_V = 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_V}`;

// Credenciais do LOGIN DO FACEBOOK. No painel da Meta, o login do Instagram tem "ID do app do
// Instagram" e chave secreta PRÓPRIOS, diferentes do ID/chave do app (Configurações do app →
// Básico) que o login do Facebook e a Marketing API usam. META_APP_ID/META_APP_SECRET seguem
// servindo o Instagram; para Ads, use META_FB_APP_ID/META_FB_APP_SECRET (com fallback para as
// antigas, caso sejam as mesmas).
const fbAppId = () => String(process.env.META_FB_APP_ID || process.env.META_APP_ID || '').trim();
const fbAppSecret = () => String(process.env.META_FB_APP_SECRET || process.env.META_APP_SECRET || '').trim();

function proof(token) {
  return crypto.createHmac('sha256', fbAppSecret()).update(String(token)).digest('hex');
}

// GET na Graph API. Lança erro com a mensagem da Meta (nunca devolve o erro como se fosse dado).
async function graphGet(caminho, params, token) {
  const qs = new URLSearchParams({ ...(params || {}), access_token: token, appsecret_proof: proof(token) });
  const r = await fetch(`${GRAPH}/${caminho}?${qs}`);
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j || j.error) {
    const err = (j && j.error) || {};
    const e = new Error(err.message || `Graph ${r.status}`);
    e.code = err.code; e.subcode = err.error_subcode; e.status = r.status;
    throw e;
  }
  return j;
}

// Lê todas as páginas de uma lista (até `max` itens) — a Graph pagina por cursor em paging.next.
async function graphLista(caminho, params, token, max = 200) {
  const out = [];
  let j = await graphGet(caminho, { limit: 50, ...(params || {}) }, token);
  for (;;) {
    out.push(...(j.data || []));
    const prox = j.paging && j.paging.next;
    if (!prox || out.length >= max) break;
    const u = new URL(prox);
    if (!u.searchParams.get('access_token')) u.searchParams.set('access_token', token);
    if (!u.searchParams.get('appsecret_proof')) u.searchParams.set('appsecret_proof', proof(token));
    const r = await fetch(u.toString());
    j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) break;
  }
  return out.slice(0, max);
}

// Erro de token (expirado/revogado/sem permissão) — diferencia "reconecte" de falha passageira.
function erroDeToken(e) {
  return !!e && (e.code === 190 || e.code === 102 || e.code === 200 || e.code === 10);
}

const STATUS_CONTA = { 1: 'ativa', 2: 'desativada', 3: 'pagamento pendente', 7: 'em análise de risco', 8: 'pagamento pendente de acerto', 9: 'em período de carência', 100: 'encerramento pendente', 101: 'encerrada' };

// Contas de anúncio que o usuário autorizou (usado no callback, para escolher qual ler).
async function listarContas(token) {
  const contas = await graphLista('me/adaccounts', { fields: 'id,account_id,name,currency,timezone_name,account_status,business{name}' }, token, 100);
  return contas.map(c => ({
    id: c.id, // "act_<n>"
    nome: c.name || c.account_id,
    moeda: c.currency || '',
    fuso: c.timezone_name || '',
    status: c.account_status,
    status_txt: STATUS_CONTA[c.account_status] || String(c.account_status),
    negocio: (c.business && c.business.name) || '',
  }));
}

// ── Resultado principal por objetivo ────────────────────────────────────────
// A Meta devolve dezenas de action_types; o "resultado" que importa depende do objetivo da
// campanha. Lista em ordem de preferência — o primeiro presente vence.
const RESULTADO_POR_OBJETIVO = {
  OUTCOME_LEADS: [['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d'], 'lead'],
  OUTCOME_SALES: [['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.messaging_conversation_started_7d'], 'compra'],
  OUTCOME_ENGAGEMENT: [['onsite_conversion.messaging_conversation_started_7d', 'post_engagement', 'page_engagement'], 'engajamento/conversa'],
  OUTCOME_TRAFFIC: [['landing_page_view', 'link_click'], 'clique'],
  OUTCOME_AWARENESS: [[], 'alcance'],
  OUTCOME_APP_PROMOTION: [['mobile_app_install', 'app_install'], 'instalação'],
};
const RESULTADO_PADRAO = [['omni_purchase', 'purchase', 'lead', 'onsite_conversion.messaging_conversation_started_7d', 'landing_page_view', 'link_click'], 'resultado'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v) => Math.round(v * 100) / 100;

function valorAcao(lista, tipo) {
  const a = (lista || []).find(x => x.action_type === tipo);
  return a ? num(a.value) : null;
}

// Normaliza uma linha de insights da Meta (strings) para números enxutos + resultado principal.
function normalizar(linha, objetivo) {
  const [tipos, rotulo] = RESULTADO_POR_OBJETIVO[objetivo] || RESULTADO_PADRAO;
  let resultados = null, tipoUsado = null;
  for (const t of tipos) {
    const v = valorAcao(linha.actions, t);
    if (v != null) { resultados = v; tipoUsado = t; break; }
  }
  if (objetivo === 'OUTCOME_AWARENESS') { resultados = num(linha.reach); tipoUsado = 'reach'; }
  const gasto = num(linha.spend);
  const roasLista = linha.purchase_roas || [];
  const roas = roasLista.length ? num(roasLista[0].value) : null;
  return {
    gasto: r2(gasto),
    impressoes: num(linha.impressions),
    alcance: num(linha.reach),
    frequencia: r2(num(linha.frequency)),
    cliques_link: num(linha.inline_link_clicks),
    ctr_link: r2(num(linha.inline_link_click_ctr)), // em %
    cpc_link: r2(num(linha.cost_per_inline_link_click)),
    cpm: r2(num(linha.cpm)),
    resultado_tipo: rotulo,
    resultado_acao: tipoUsado,
    resultados: resultados || 0,
    custo_por_resultado: resultados ? r2(gasto / resultados) : null,
    roas: roas != null ? r2(roas) : null,
  };
}

const CAMPOS_INSIGHTS = 'spend,impressions,reach,frequency,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click,cpm,actions,purchase_roas';

function isoDia(d) { return d.toISOString().slice(0, 10); }
// Janelas fechadas (sem o dia de hoje, que ainda está acumulando): últimos 7 dias e os 7 anteriores.
function janelas() {
  const ontem = new Date(); ontem.setUTCDate(ontem.getUTCDate() - 1);
  const ini7 = new Date(ontem); ini7.setUTCDate(ini7.getUTCDate() - 6);
  const fimAnt = new Date(ini7); fimAnt.setUTCDate(fimAnt.getUTCDate() - 1);
  const iniAnt = new Date(fimAnt); iniAnt.setUTCDate(iniAnt.getUTCDate() - 6);
  return {
    atual: { since: isoDia(ini7), until: isoDia(ontem) },
    anterior: { since: isoDia(iniAnt), until: isoDia(fimAnt) },
  };
}

// ── Coleta completa de uma conta (só leitura) ───────────────────────────────
async function coletarConta(token, actId) {
  const J = janelas();
  const conta = await graphGet(actId, { fields: 'name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap' }, token);

  // Campanhas (com objetivo e status) — define o resultado principal de cada uma.
  const camps = await graphLista(`${actId}/campaigns`, {
    fields: 'id,name,objective,status,effective_status',
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES']),
  }, token, 200);
  const objetivoDe = {}; const statusDe = {};
  for (const c of camps) { objetivoDe[c.id] = c.objective; statusDe[c.id] = c.effective_status || c.status; }

  const insights = (nivel, janela, extra) => graphLista(`${actId}/insights`, {
    level: nivel, time_range: JSON.stringify(janela), fields: CAMPOS_INSIGHTS + (extra ? ',' + extra : ''),
  }, token, 300);

  const [cAtual, cAnt, aAtual, aAnt] = await Promise.all([
    insights('campaign', J.atual, 'campaign_id,campaign_name,objective'),
    insights('campaign', J.anterior, 'campaign_id,objective'),
    insights('ad', J.atual, 'ad_id,ad_name,adset_name,campaign_id,campaign_name,objective'),
    insights('ad', J.anterior, 'ad_id,campaign_id,objective'),
  ]);

  const antCamp = {}; for (const l of cAnt) antCamp[l.campaign_id] = normalizar(l, l.objective || objetivoDe[l.campaign_id]);
  const antAd = {}; for (const l of aAnt) antAd[l.ad_id] = normalizar(l, l.objective || objetivoDe[l.campaign_id]);

  const campanhas = cAtual.map(l => {
    const obj = l.objective || objetivoDe[l.campaign_id];
    return { id: l.campaign_id, nome: l.campaign_name, objetivo: obj || '', status: statusDe[l.campaign_id] || '', ...normalizar(l, obj), anterior: antCamp[l.campaign_id] || null };
  }).sort((a, b) => b.gasto - a.gasto);

  const anuncios = aAtual.map(l => {
    const obj = l.objective || objetivoDe[l.campaign_id];
    return { id: l.ad_id, nome: l.ad_name, conjunto: l.adset_name, campanha: l.campaign_name, campanha_id: l.campaign_id, ...normalizar(l, obj), anterior: antAd[l.ad_id] || null };
  }).sort((a, b) => b.gasto - a.gasto);

  // Anúncios reprovados ou com problema de entrega (independe de ter gasto na janela).
  let problemas = [];
  try {
    const ads = await graphLista(`${actId}/ads`, {
      fields: 'id,name,effective_status,ad_review_feedback,issues_info,campaign{name}',
      effective_status: JSON.stringify(['DISAPPROVED', 'WITH_ISSUES']),
    }, token, 50);
    problemas = ads.map(a => ({
      id: a.id, nome: a.name, campanha: (a.campaign && a.campaign.name) || '', status: a.effective_status,
      motivo: String(
        (a.ad_review_feedback && a.ad_review_feedback.global && Object.values(a.ad_review_feedback.global).join(' · '))
        || ((a.issues_info || [])[0] && (a.issues_info[0].error_summary || a.issues_info[0].error_message)) || ''
      ).slice(0, 240),
    }));
  } catch (e) { problemas = []; }

  const tot = campanhas.reduce((t, c) => { t.gasto += c.gasto; t.impressoes += c.impressoes; t.cliques_link += c.cliques_link; return t; }, { gasto: 0, impressoes: 0, cliques_link: 0 });

  return {
    janela: J.atual,
    janela_anterior: J.anterior,
    conta: {
      id: actId, nome: conta.name || '', moeda: conta.currency || '', fuso: conta.timezone_name || '',
      status: conta.account_status, status_txt: STATUS_CONTA[conta.account_status] || String(conta.account_status),
      motivo_desativacao: conta.disable_reason || 0,
      // amount_spent / spend_cap vêm em CENTAVOS da moeda da conta.
      gasto_total: r2(num(conta.amount_spent) / 100),
      limite_gasto: conta.spend_cap ? r2(num(conta.spend_cap) / 100) : null,
    },
    resumo_7d: {
      gasto: r2(tot.gasto), impressoes: tot.impressoes, cliques_link: tot.cliques_link,
      ctr_link: tot.impressoes ? r2((tot.cliques_link / tot.impressoes) * 100) : 0,
      campanhas_com_gasto: campanhas.filter(c => c.gasto > 0).length,
    },
    campanhas: campanhas.slice(0, 30),
    anuncios: anuncios.slice(0, 60),
    problemas,
  };
}

// ── Alertas (só o que pede ação ou deu errado) ──────────────────────────────
// Limiares alinhados à persona do Tráfego (fadiga: CTR < 1% após ~1000 impressões, frequência > 3).
const LIMIAR = {
  FREQ_FADIGA: 3,
  CTR_BAIXO: 1,          // % de CTR de link
  IMPRESSOES_MIN: 1000,  // abaixo disso o CTR ainda não diz nada
  QUEDA_CTR: 0.3,        // queda de 30%+ vs. 7 dias anteriores
  GASTO_SEM_RESULTADO_PCT: 0.2, // campanha com ≥20% do gasto da conta e zero resultado
};

function detectarAlertas(snap) {
  const out = [];
  const c = snap.conta || {};
  if (c.status && c.status !== 1) {
    out.push({ tipo: 'conta', chave: `conta_${c.status}`, titulo: 'Conta de anúncios com restrição', msg: `Sua conta de anúncios "${c.nome}" está ${c.status_txt}. Os anúncios não rodam até isso ser resolvido no Gerenciador de Anúncios.` });
  }
  for (const p of snap.problemas || []) {
    const rep = p.status === 'DISAPPROVED';
    out.push({ tipo: rep ? 'reprovado' : 'problema', chave: `${rep ? 'rep' : 'prob'}_${p.id}`, titulo: rep ? 'Anúncio reprovado pela Meta' : 'Anúncio com problema de entrega', msg: `"${p.nome}" (campanha "${p.campanha}")${p.motivo ? ' — ' + p.motivo : ''}. Fale com o Agente de Tráfego para ajustar.` });
  }
  for (const a of snap.anuncios || []) {
    if (a.impressoes < LIMIAR.IMPRESSOES_MIN) continue;
    const caiu = a.anterior && a.anterior.ctr_link > 0 && a.anterior.impressoes >= LIMIAR.IMPRESSOES_MIN && a.ctr_link < a.anterior.ctr_link * (1 - LIMIAR.QUEDA_CTR);
    if (a.frequencia > LIMIAR.FREQ_FADIGA && (a.ctr_link < LIMIAR.CTR_BAIXO || caiu)) {
      out.push({ tipo: 'fadiga', chave: `fadiga_${a.id}`, titulo: 'Criativo dando sinal de cansaço', msg: `O anúncio "${a.nome}" está com frequência ${a.frequencia} e CTR ${a.ctr_link}%${caiu ? ` (era ${a.anterior.ctr_link}% na semana anterior)` : ''}. O público já viu demais — peça ao Agente de Tráfego uma análise.` });
    }
  }
  const gastoConta = (snap.resumo_7d && snap.resumo_7d.gasto) || 0;
  for (const k of snap.campanhas || []) {
    if (k.objetivo === 'OUTCOME_AWARENESS' || !gastoConta) continue;
    if (k.gasto > 0 && k.resultados === 0 && k.gasto >= gastoConta * LIMIAR.GASTO_SEM_RESULTADO_PCT) {
      out.push({ tipo: 'sem_resultado', chave: `semres_${k.id}`, titulo: 'Campanha gastando sem resultado', msg: `A campanha "${k.nome}" gastou ${c.moeda} ${k.gasto.toFixed(2)} nos últimos 7 dias sem nenhum ${k.resultado_tipo}. Vale revisar público, oferta ou criativo com o Agente de Tráfego.` });
    }
  }
  return out;
}

// Texto compacto para o contexto do Agente de Tráfego (ADS_DATA).
function resumoParaAgente(snap, dataColeta) {
  if (!snap || !snap.conta) return '';
  const c = snap.conta; const m = c.moeda;
  const fmt = (x) => x == null ? '—' : x;
  const linhaCamp = (k) => `- ${k.nome} [${k.objetivo || '?'} · ${k.status}] gasto ${m} ${k.gasto} · ${k.resultados} ${k.resultado_tipo} · custo/result ${fmt(k.custo_por_resultado)} · CTR ${k.ctr_link}% · CPM ${k.cpm} · freq ${k.frequencia}${k.roas != null ? ' · ROAS ' + k.roas : ''}${k.anterior ? ` (7d antes: gasto ${k.anterior.gasto}, ${k.anterior.resultados} result, CTR ${k.anterior.ctr_link}%)` : ''}`;
  const linhaAd = (a) => `- ${a.nome} (${a.campanha} › ${a.conjunto}) gasto ${a.gasto} · ${a.resultados} ${a.resultado_tipo} · CTR ${a.ctr_link}% · freq ${a.frequencia} · ${a.impressoes} impr.${a.anterior ? ` (CTR 7d antes ${a.anterior.ctr_link}%)` : ''}`;
  const camps = (snap.campanhas || []).filter(k => k.gasto > 0).slice(0, 12);
  const ads = (snap.anuncios || []).filter(a => a.gasto > 0).slice(0, 15);
  return [
    `\nADS_DATA — NÚMEROS REAIS DA CONTA DE ANÚNCIOS (lidos pela Meta Marketing API em ${dataColeta}; janela ${snap.janela.since} a ${snap.janela.until}; moeda ${m}). Use estes números, não peça ao cliente o que já está aqui:`,
    `CONTA: ${c.nome} · ${c.status_txt}${c.limite_gasto ? ` · limite de gasto ${c.limite_gasto}` : ''}`,
    `RESUMO 7D: gasto ${snap.resumo_7d.gasto} · ${snap.resumo_7d.impressoes} impressões · CTR link ${snap.resumo_7d.ctr_link}% · ${snap.resumo_7d.campanhas_com_gasto} campanhas com gasto`,
    camps.length ? 'CAMPANHAS (7d):\n' + camps.map(linhaCamp).join('\n') : 'CAMPANHAS: nenhuma campanha com gasto nos últimos 7 dias.',
    ads.length ? 'ANÚNCIOS (7d, maiores gastos):\n' + ads.map(linhaAd).join('\n') : '',
    (snap.problemas || []).length ? 'REPROVADOS/COM PROBLEMA:\n' + snap.problemas.map(p => `- ${p.nome} (${p.status}): ${p.motivo || 'sem motivo informado'}`).join('\n') : '',
  ].filter(Boolean).join('\n');
}

module.exports = { GRAPH_V, GRAPH, fbAppId, fbAppSecret, proof, graphGet, graphLista, erroDeToken, listarContas, coletarConta, detectarAlertas, resumoParaAgente, normalizar, janelas, LIMIAR };
