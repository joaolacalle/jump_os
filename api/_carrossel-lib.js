// api/_carrossel-lib.js — CARROSSEL É UMA HISTÓRIA, NÃO VÁRIAS CAPAS (02/out/2026, pedido do João:
// "as imagens saíram praticamente com o mesmo roteiro; carrossel não são várias capas do mesmo, é um
// tema maior dividido em mais imagens, com uma capa chamativa").
//
// Causa: o worker mandava a MESMA headline/subheadline/prova/CTA para todos os slides — o Engine só
// recebia "slide 2 de 4, mude a headline", sem headline nova. Agora a Estratégia escreve o roteiro de
// cada slide no detalhamento (meta.slides_texto = [{headline, texto}], um por slide, na ordem) e o
// worker entrega a cada slide o texto DELE. O Engine 6.0 não muda: só as entradas.
//   slide 1 = capa (gancho) · slides do meio = uma ideia cada · último = conclusão + chamada
// Limites = os do Engine (validarTextoDaPeca): headline ≤ 8 palavras, texto (vai como subheadline) ≤ 6.

const LIM_HEADLINE = 8;
const LIM_TEXTO = 6;

function _palavras(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

// Normaliza o que veio do agente: aceita [{headline,texto}] ou [{titulo,texto}] ou ["..."].
function normalizarSlides(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => {
    if (typeof x === 'string') return { headline: x.trim(), texto: '' };
    const o = x || {};
    return { headline: String(o.headline || o.titulo || o.title || '').trim(), texto: String(o.texto || o.subheadline || o.text || '').trim() };
  });
}

// Problemas do roteiro de slides para um carrossel de `total` slides ('' = ok).
function problemasSlides(slides, total) {
  const s = normalizarSlides(slides);
  const n = Number(total) || 0;
  if (!s.length) return 'carrossel sem o roteiro dos slides ("slides": um item por slide — capa, desenvolvimento, fechamento)';
  if (n >= 2 && s.length !== n) return 'carrossel de ' + n + ' slides com roteiro de ' + s.length + ' — precisa de exatamente ' + n;
  if (s.length < 2) return 'carrossel precisa de pelo menos 2 slides no roteiro';
  for (let i = 0; i < s.length; i++) {
    const it = s[i];
    if (!it.headline) return 'slide ' + (i + 1) + ' sem headline';
    if (_palavras(it.headline) > LIM_HEADLINE) return 'slide ' + (i + 1) + ': headline com ' + _palavras(it.headline) + ' palavras (máx ' + LIM_HEADLINE + ')';
    if (_palavras(it.texto) > LIM_TEXTO) return 'slide ' + (i + 1) + ': texto com ' + _palavras(it.texto) + ' palavras (máx ' + LIM_TEXTO + ')';
  }
  const iguais = new Set(s.map(it => it.headline.toLowerCase())).size;
  if (iguais < s.length) return 'slides com headline repetida — cada slide tem que avançar a história';
  return '';
}

// Texto que o worker entrega ao Engine para o slide n (1..total). Sem roteiro → null (o worker
// segue exatamente como antes: mesmo texto em todos os slides, carrosséis antigos não mudam).
// Prova só na capa; CTA só no último slide.
function textoDoSlide(meta, n, total) {
  const s = normalizarSlides((meta || {}).slides_texto);
  if (!s.length || !s[n - 1]) return null;
  const it = s[n - 1];
  const ultimo = n >= (Number(total) || s.length);
  return {
    headline: it.headline,
    subheadline: it.texto,
    prova: n === 1 ? String((meta || {}).prova || '') : '',
    cta_arte: ultimo ? String((meta || {}).cta_arte || '') : '',
  };
}

module.exports = { LIM_HEADLINE, LIM_TEXTO, normalizarSlides, problemasSlides, textoDoSlide };
