// api/_demanda-lib.js — TEMAS QUE VENDEM, NÃO TEMAS GENÉRICOS (01/out/2026, pedido do João: "achei
// os temas muito genéricos, só repetem o onboarding, cara de IA").
//
// Causa: a Estratégia só recebia dados SOBRE A MARCA (DNA, diferenciais, preço) e transformava cada
// resposta do onboarding num post. Nada sobre a cabeça do comprador, nada obrigando cada post a
// atacar uma dor real. Aqui a regra vira mecanismo, aplicado ao gravar o PLANO (não avulso):
//   1) MAPA DE DEMANDA antes do plano: memórias dores_publico e objecoes_compra precisam existir
//      (o agente monta com Mercado, Visitas, pesquisa e 2 perguntas ao cliente).
//   2) Cada post declara publico, dor (dor ou objeção que ataca), etapa (atrair|convencer|vender)
//      e angulo. Sem isso, o post é recusado.
//   3) Nada de dado interno do cliente como tema (seguidores, ticket médio, faturamento), nada do
//      dono em terceira pessoa, nada de palavra vazia de IA.
//   4) Sem repetir o mesmo ângulo para a mesma dor no plano.
//   5) Mistura do funil: o plano não pode ser quase só venda (atrair ≥ 30%, vender ≤ 40%).
// O agente decide o conteúdo; o código só recusa o que é genérico e avisa o cliente.

const CHAVES_MAPA = ['segmentos_publico', 'dores_publico', 'objecoes_compra', 'perguntas_frequentes', 'gatilhos_compra'];
const CHAVES_MAPA_OBRIGATORIAS = ['dores_publico', 'objecoes_compra'];

const ETAPAS = ['atrair', 'convencer', 'vender'];
const ANGULOS = ['erro_comum', 'demonstracao', 'comparacao', 'bastidor', 'caso_real', 'objecao', 'pergunta_frequente', 'passo_a_passo', 'opiniao', 'mito'];

// palavras e muletas que denunciam texto genérico de IA (no TEMA do post)
const PALAVRAS_VAZIAS = [
  'transforme', 'transformar sua', 'descubra', 'de verdade', 'sem complicação', 'solução definitiva',
  'revolucion', 'segredo', 'incrível', 'game changer', 'alavanc', 'potencializ', 'desbloque',
  'jornada', 'o poder de', 'eleve seu', 'eleve sua', 'próximo nível', 'mude sua vida',
];
// dado interno do cliente usado como tema (interessa a ele, não ao comprador)
const RE_METRICA_INTERNA = /\b(\d[\d.]*\s*)?seguidores?\s+(parados|ociosos|inativos|atuais|que (eu|já) tenho)|ticket\s+m[eé]dio|meu\s+faturamento|minha\s+conta\s+(parada|zerada)|\bconta\s+zerada\b/i;

function _sem(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

function normalizarEtapa(v) {
  const x = _sem(v);
  if (/atra|topo|descob|alcance/.test(x)) return 'atrair';
  if (/conven|consider|meio|educ|confian/.test(x)) return 'convencer';
  if (/vend|fundo|conver|oferta|compra/.test(x)) return 'vender';
  return '';
}
function normalizarAngulo(v) {
  const x = _sem(v).replace(/[\s-]+/g, '_');
  if (!x) return '';
  const achado = ANGULOS.find(a => x.includes(a) || a.includes(x));
  if (achado) return achado;
  if (/erro/.test(x)) return 'erro_comum';
  if (/demonst|tutorial|mostr/.test(x)) return 'demonstracao';
  if (/compar|versus|\bvs\b/.test(x)) return 'comparacao';
  if (/bastid/.test(x)) return 'bastidor';
  if (/caso|depoim|resultado|prova/.test(x)) return 'caso_real';
  if (/pergunt|duvid/.test(x)) return 'pergunta_frequente';
  if (/passo|guia|como_/.test(x)) return 'passo_a_passo';
  return x.slice(0, 30);
}

// Nomes que o tema não pode usar em 3ª pessoa: nome da marca quando é nome de pessoa, e o 1º nome.
function nomesDoDono(marca) {
  const m = String(marca || '').trim();
  if (!m) return [];
  const partes = m.split(/\s+/).filter(p => p.length >= 3);
  // só trata como nome de pessoa marca curta com 1-3 palavras capitalizadas (ex.: "João Vittor")
  if (partes.length < 1 || partes.length > 3 || !partes.every(p => /^[A-ZÀ-Ý]/.test(p))) return [];
  return [m, partes[0]];
}

// Normaliza os campos do post (mutado) e devolve o motivo da recusa, ou '' se o post está bom.
function motivoRecusa(ct, opts) {
  const o = opts || {};
  ct.etapa = normalizarEtapa(ct.etapa || ct.funil);
  ct.angulo = normalizarAngulo(ct.angulo);
  ct.publico = String(ct.publico || '').trim().slice(0, 120);
  ct.dor = String(ct.dor || ct.objecao || '').trim().slice(0, 200);
  const faltam = [];
  if (!ct.publico) faltam.push('público');
  if (!ct.dor) faltam.push('dor/objeção atacada');
  if (!ct.etapa) faltam.push('etapa (atrair/convencer/vender)');
  if (!ct.angulo) faltam.push('ângulo');
  if (faltam.length) return 'post sem ' + faltam.join(', ') + ' — todo post do plano precisa dizer para quem é e o que ataca';
  const tema = String(ct.tema || '');
  const temaN = _sem(tema);
  if (RE_METRICA_INTERNA.test(tema)) return 'tema usa dado interno da conta (seguidores, ticket médio, faturamento) — isso não interessa a quem compra';
  const vazia = PALAVRAS_VAZIAS.find(p => temaN.includes(_sem(p)));
  if (vazia) return 'tema genérico ("' + vazia + '") — troque por uma situação concreta do público';
  const nome = (o.nomesDono || []).find(n => n && new RegExp('(^|[^a-zà-ÿ])' + _sem(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-zà-ÿ]|$)').test(temaN));
  if (nome) return 'tema fala do dono em terceira pessoa ("' + nome + '") — escreva na voz da marca, para o público';
  return '';
}

// REPETIÇÃO NO PLANO (ajustado 01/out/2026 — caso real: mapa com uma dor central e 13 posts; a
// regra antiga "nunca o mesmo ângulo para a mesma dor" tornava o plano impossível e derrubou tudo
// por 1 tema). Agora: o mesmo ângulo para a mesma dor vale até 2 vezes no plano, e o que é
// recusado de verdade é tema quase igual a outro (mesmas palavras). Devolve a lista de problemas.
function _palavras(t) { return new Set(_sem(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3)); }
function repeticoes(posts) {
  const problemas = [];
  const cont = {};
  const vistos = [];
  (posts || []).forEach(ct => {
    const tema = String(ct.tema || 'post');
    const k = chaveRepeticao(ct);
    cont[k] = (cont[k] || 0) + 1;
    if (cont[k] > 2) problemas.push('"' + tema.slice(0, 70) + '": terceiro post com o mesmo ângulo para a mesma dor — varie o ângulo');
    const pw = _palavras(tema);
    const igual = pw.size < 3 ? null : vistos.find(v => v.pw.size >= 3 && (() => { const inter = [...pw].filter(w => v.pw.has(w)).length; const uni = new Set([...pw, ...v.pw]).size; return uni && inter / uni >= 0.55; })());
    if (igual) problemas.push('"' + tema.slice(0, 70) + '": quase igual a "' + igual.tema.slice(0, 50) + '"');
    vistos.push({ tema, pw });
  });
  return problemas;
}

// Chave de repetição: mesmo ângulo para a mesma dor.
function chaveRepeticao(ct) { return (ct.angulo || '') + '|' + _sem(ct.dor).replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3).slice(0, 6).sort().join(' '); }

// Mistura do funil no lote (só a partir de 5 posts): devolve '' ou o motivo da recusa do plano.
function motivoFunil(posts) {
  const n = (posts || []).length;
  if (n < 5) return '';
  const c = { atrair: 0, convencer: 0, vender: 0 };
  posts.forEach(p => { if (c[p.etapa] != null) c[p.etapa]++; });
  const pA = c.atrair / n, pV = c.vender / n;
  if (pA < 0.3 || pV > 0.4) {
    return 'mistura do funil fora do equilíbrio (' + c.atrair + ' atrair, ' + c.convencer + ' convencer, ' + c.vender + ' vender em ' + n + ' posts) — o plano precisa de pelo menos 30% de posts para atrair (sobre a dor do público, sem falar do produto) e no máximo 40% de venda';
  }
  return '';
}

// A fala anterior do agente fez as 2 perguntas do mapa? (o que perguntam antes de comprar / por
// que quem não comprou desistiu). Tolerante a variação de redação, exigente nas duas ideias.
function perguntouMapa(falaAnterior) {
  const t = _sem(falaAnterior);
  if (!t.includes('?')) return false;
  const p1 = /(pergunt|duvid)\w*[^?]{0,60}antes de (comprar|fechar|assinar|contratar)|antes de (comprar|fechar|assinar|contratar)[^?]{0,60}(pergunt|duvid)/.test(t);
  const p2 = /(nao (comprou|comprar|fechou|fechar|assinou|assinar|contratou)|desist)/.test(t);
  return p1 && p2;
}

// CHECAGEM DO PLANO INTEIRO (01/out/2026): mesma ordem de sempre — mapa de demanda, cada post,
// repetição, funil. Devolve { geral, problemas }: 'geral' só quando o mapa falta (depende do cliente,
// não dá para a Estratégia corrigir sozinha) ou a mistura do funil está fora; 'problemas' = temas.
// Usada na 1ª checagem e na reconferência depois da correção automática (mesma regra, uma fonte).
function checarPlano(plano, mapa) {
  const problemas = [];
  if (!mapaCompleto(mapa)) return { geral: 'mapa', problemas, faltaMapa: true };
  const nomes = nomesDoDono((mapa || {}).marca);
  (plano || []).forEach(ct => {
    const m = motivoRecusa(ct, { nomesDono: nomes });
    if (m) problemas.push('"' + String(ct.tema || 'post').slice(0, 70) + '": ' + m);
  });
  if (!problemas.length) problemas.push(...repeticoes(plano));
  const geral = problemas.length ? '' : motivoFunil(plano);
  return { geral, problemas, faltaMapa: false };
}

// FALA HONESTA QUANDO O PLANO NÃO FOI GRAVADO (01/out/2026, caso real: a Estratégia escreveu
// "o plano está pronto para aprovação em Tarefas" e o controle de qualidade tinha recusado o plano —
// o João viu "erro" sem entender). Tira da fala só as frases que prometem o card/aprovação e diz que
// o plano não foi salvo; o motivo vem no aviso do sistema logo abaixo. Nunca mexe dentro de tags.
const RE_PROMESSA_PLANO = /(pronto para (a |sua )?aprova|aprova[çc][ãa]o em (tarefas|aprovar)|assim que (voc[êe] )?aprovar|card[^.!?\n]{0,40}(aprovar|aprova[çc][ãa]o)|plano[^.!?\n]{0,40}(est[áa]|foi) (gravad|salv)o)/i;
function falaPlanoNaoSalvo(texto) {
  const partes = String(texto == null ? '' : texto).split(/(<([a-z_]+)>[\s\S]*?<\/\2>)/g);
  const out = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (p == null) continue;
    if (/^<([a-z_]+)>[\s\S]*<\/\1>$/.test(p)) { out.push(p); i++; continue; } // tag inteira (pula o grupo do nome)
    out.push(p.replace(/[^.!?\n<>]*[.!?]?/g, f => (f.trim() && RE_PROMESSA_PLANO.test(f)) ? '' : f));
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n\n⚠️ O plano ainda não foi salvo — veja o motivo logo abaixo.';
}

function mapaCompleto(memorias) {
  const m = memorias || {};
  return CHAVES_MAPA_OBRIGATORIAS.every(k => String(m[k] || '').trim().length > 0);
}

module.exports = { falaPlanoNaoSalvo, checarPlano, perguntouMapa, CHAVES_MAPA, CHAVES_MAPA_OBRIGATORIAS, ETAPAS, ANGULOS, PALAVRAS_VAZIAS, normalizarEtapa, normalizarAngulo, nomesDoDono, motivoRecusa, chaveRepeticao, repeticoes, motivoFunil, mapaCompleto };
