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

module.exports = { DNA_CAMPOS_OBRIGATORIOS, DNA_ENUMS, dnaValorAceito, dnaFaltando };
