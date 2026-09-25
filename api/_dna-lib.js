// api/_dna-lib.js — FONTE ÚNICA do DNA visual obrigatório (22/set/2026, "Engine 6.0 Rodada 2",
// Causa 2, autorizado pelo João). Sem estes campos preenchidos, o Engine (api/gerar-imagem.js,
// engine6()) cai nos fallbacks hardcoded (BALANCED/MEDIA/PREMIUM/EDITORIAL) — a peça sai no
// padrão "achatado" em vez do padrão real da marca. É a causa raiz exata da diferença de
// densidade entre a peça gerada pelo Engine colado num chat (13-15 elementos, denso) e a
// mesma peça pelo pipeline (4 elementos, metade da tela vazia) que o João comparou lado a lado
// pra abrir esta rodada.
//
// Módulo helper, sem handler próprio — mesmo padrão de _composicao-lib.js/assets/classificacao.js
// (não conta no limite de funções da Vercel). Requerido por:
//   - api/agente-chat.js: valida o check-in do Identidade EM CÓDIGO (a tag <checkin_completo/>
//     sozinha nunca bastou — não validava nada; só olhava paleta_primaria+estilo_visual, e só
//     pro agente Criativo avisar, nunca pra travar a conclusão do check-in em si).
//   - api/gerar-imagem.js: sinaliza, em log e em conteudos.meta, quando uma geração roda com o
//     DNA incompleto — NUNCA escreve nada no DNA do cliente. Preencher é exclusividade do
//     onboarding (Identidade); este módulo só lê e sinaliza.

// Mínimo pra uma peça sair no padrão real da marca — lista literal definida pelo João.
const DNA_CAMPOS_OBRIGATORIOS = [
  'intensidade_visual', 'complexidade_visual', 'temperatura_emocional', 'estilo_visual',
  'tipografia_primaria', 'tipografia_secundaria', 'cor_cta', 'cor_fundo', 'paleta_primaria',
];

// Conjuntos aceitos dos campos de enumeração do DNA — os MESMOS valores que a própria
// instrução do Identidade (api/agente-chat.js, bloco "FLUXO FINAL" do prompt da persona) já
// pede ao agente pra usar, e os MESMOS rótulos que api/gerar-imagem.js:engine6() usa pra
// mapear intensidade/complexidade em parâmetros reais do Engine (vazio/elementos). Antes
// viviam só como texto de instrução, que o modelo podia esquecer ou digitar errado; aqui
// viram validação em código.
const DNA_ENUMS = {
  complexidade_visual:   ['MINIMAL', 'BALANCED', 'DENSE'],
  intensidade_visual:    ['BAIXA', 'MEDIA', 'ALTA', 'EXTREMA'],
  estilo_visual:         ['EDITORIAL', 'MINIMAL', 'TECNOLOGICO', 'LUXO', 'STREET', 'CORPORATIVO'],
  temperatura_emocional: ['PREMIUM', 'CALMO', 'TENSO', 'URGENTE', 'LUXUOSO', 'AGRESSIVO'],
};

// Compara sem diferenciar maiúsculas/acento — mesma tolerância que engine6() já dava sozinho
// a 'MEDIA'/'MÉDIA' (ver o mapa de vazio% em gerar-imagem.js), generalizada aqui pra qualquer
// campo de enumeração.
const _semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// campo fora de DNA_ENUMS (ex.: tipografia_primaria, cor_cta) não é enumeração — qualquer
// valor não vazio é aceito; só os quatro campos acima têm conjunto fechado.
function dnaValorAceito(campo, valor) {
  const aceitos = DNA_ENUMS[campo];
  if (!aceitos) return true;
  const v = _semAcento(String(valor == null ? '' : valor).trim()).toUpperCase();
  return aceitos.some(a => _semAcento(a).toUpperCase() === v);
}

// Recebe um mapa {chave: valor} (o DNA atual do cliente, lido do banco) e devolve a lista dos
// obrigatórios que estão vazios ou ausentes — nunca escreve nada, só lê.
function dnaFaltando(mapaDna) {
  const m = mapaDna || {};
  return DNA_CAMPOS_OBRIGATORIOS.filter(c => !String(m[c] == null ? '' : m[c]).trim());
}

// ── DNA DE DIREÇÃO DE ARTE (rodada "O onboarding passa a captar o DNA de direção de arte",
// 25/set/2026, autorizado pelo João) — 21 campos que engine6() (api/gerar-imagem.js) também
// consome (17 por nome literal + 4 via a varredura genérica de chaves vs_*, que exclui só
// vs_modo_humano/vs_controle_foco_fotografico/vs_hierarquia_visual/vs_profundidade_visual da
// varredura porque essas 4 já têm seção própria — mas são consumidas igual, só que por nome
// literal em vez de pela varredura). Sem eles a peça cai nos fallbacks hardcoded do Engine
// (BALANCED/MEDIA/PREMIUM/EDITORIAL) e sai no padrão achatado. Texto livre, sem enumeração —
// qualquer valor não vazio é aceito, por isso não entram em DNA_ENUMS. estilo_de_mockup é um
// 22º campo, OPCIONAL de propósito (só faz sentido pra negócio com tela/software) — por isso
// NÃO está nesta lista e dnaDirecaoFaltando() nunca o exige.
const DNA_CAMPOS_DIRECAO = [
  'densidade_visual', 'tipo_de_composicao', 'tipo_de_contraste', 'temperatura_cromatica',
  'estilo_visual_descricao', 'estilo_de_copy', 'tom_do_cta', 'estilo_iconografico',
  'momento_negocio', 'objetivo_conteudo', 'sempre_fazer', 'nunca_fazer',
  'vs_comportamento_headline', 'vs_comportamento_copy', 'vs_comportamento_cta',
  'vs_comportamento_label', 'vs_fluxo_leitura', 'vs_hierarquia_visual', 'vs_profundidade_visual',
  'vs_controle_foco_fotografico', 'vs_modo_humano',
];

// Mesmo padrão de dnaFaltando — só lê, nunca escreve. Lista separada (nunca somada a
// DNA_CAMPOS_OBRIGATORIOS) porque o portão de <checkin_completo/> em api/agente-chat.js precisa
// reportar as duas listas distintamente (obrigatórios vs. direção) nos logs e no checklist.
function dnaDirecaoFaltando(mapaDna) {
  const m = mapaDna || {};
  return DNA_CAMPOS_DIRECAO.filter(c => !String(m[c] == null ? '' : m[c]).trim());
}

// ── FATIA DO DNA POR AGENTE (rodada "Fonte única do DNA da marca", 25/set/2026, autorizado
// pelo João) — decide, olhando só o NOME da chave, quem recebe o quê. Único lugar onde esta
// classificação existe — api/agente-chat.js só chama fatiaDoAgente(), nunca reimplementa a
// lista aqui. IDENTIDADE não usa fatia nenhuma: recebe o DNA inteiro, porque é o agente que
// escreve o DNA — os outros agentes é que têm visão parcial.

// BASE — todo agente recebe: o núcleo de negócio/voz da marca, nada de visual ou vídeo.
const DNA_BASE = [
  'marca', 'nicho', 'arquetipo', 'posicionamento', 'publico_alvo', 'produtos_precos',
  'diferenciais', 'emocao_central', 'tom_de_voz', 'objetivo', 'estilo_de_copy', 'sempre_fazer',
  'nunca_fazer', 'objetivo_conteudo', 'momento_negocio',
];

// VISUAL — só identidade e criativo (mais qualquer chave com prefixo vs_).
const DNA_VISUAL = [
  'dna_visual', 'paleta_primaria', 'paleta_secundaria', 'paleta_terciaria', 'cor_cta',
  'cor_fundo', 'tipografia_primaria', 'tipografia_secundaria', 'estilo_visual',
  'intensidade_visual', 'complexidade_visual', 'temperatura_emocional', 'estilo_fotografico',
  'tipo_de_composicao', 'nivel_de_agressividade', 'elementos_obrigatorios',
  'elementos_proibidos', 'densidade_visual', 'tipo_de_contraste', 'temperatura_cromatica',
  'estilo_visual_descricao', 'estilo_iconografico', 'estilo_de_mockup', 'tom_do_cta',
  'referencia_aprovada', 'evitar_visual',
];

// VIDEO — só identidade e video (mais qualquer chave com prefixo video_).
const DNA_VIDEO = ['perfil_video'];

// Chave que não está em nenhuma lista acima e não tem prefixo conhecido (vs_/video_) entra na
// BASE, visível a todos — regra da chave nova, obrigatória: o DNA é vivo, os agentes criam
// chaves novas, e nenhuma chave pode ficar invisível para todo mundo por não ter sido
// classificada. Errar para o lado de aparecer demais é barato; sumir em silêncio não é opção.
function _fatiaDaChave(chave) {
  const c = String(chave == null ? '' : chave);
  if (DNA_VISUAL.includes(c) || /^vs_/.test(c)) return 'visual';
  if (DNA_VIDEO.includes(c) || /^video_/.test(c)) return 'video';
  return 'base';
}

// Recebe o AGENTE e o mapa {chave:valor} já deduplicado (uma linha por chave — ver a regra de
// desempate em api/agente-chat.js) e devolve só a fatia que esse agente deveria ver. identidade
// recebe o mapa inteiro, sem cópia filtrada — é o mesmo objeto, nunca fatiado.
function fatiaDoAgente(agente, mapaDnaFinal) {
  const m = mapaDnaFinal || {};
  if (agente === 'identidade') return m;
  const fatia = {};
  for (const chave of Object.keys(m)) {
    const f = _fatiaDaChave(chave);
    if (f === 'base') { fatia[chave] = m[chave]; }
    else if (f === 'visual' && agente === 'criativo') { fatia[chave] = m[chave]; }
    else if (f === 'video' && agente === 'video') { fatia[chave] = m[chave]; }
  }
  return fatia;
}

module.exports = {
  DNA_CAMPOS_OBRIGATORIOS, DNA_ENUMS, dnaValorAceito, dnaFaltando,
  DNA_CAMPOS_DIRECAO, dnaDirecaoFaltando,
  DNA_BASE, DNA_VISUAL, DNA_VIDEO, fatiaDoAgente,
};
