// api/_carrossel-lib.js — CARROSSEL É UMA HISTÓRIA, NÃO VÁRIAS CAPAS (02/out/2026, pedido do João:
// "as imagens saíram praticamente com o mesmo roteiro; carrossel não são várias capas do mesmo, é um
// tema maior dividido em mais imagens, com uma capa chamativa").
//
// Causa: o worker mandava a MESMA headline/subheadline/prova/CTA para todos os slides — o Engine só
// recebia "slide 2 de 4, mude a headline", sem headline nova. Agora a Estratégia escreve o roteiro de
// cada slide no detalhamento (meta.slides_texto = [{headline, texto, visual}], um por slide, na ordem)
// e o worker entrega a cada slide o texto DELE. O Engine 6.0 só recebe entradas diferentes.
//   slide 1 = capa (gancho) · slides do meio = uma ideia cada · último = conclusão + chamada
// Ajustes de 02/out (2ª rodada, revisão do João sobre as artes):
//   - texto de apoio até 12 palavras (o limite do Engine subiu de 6 para 12, autorizado);
//   - "visual": o objeto/cena que prova o slide (calendário, relógio...) vai como contexto da cena;
//   - a capa que promete um número ("5 sinais") exige exatamente esse número de slides do meio;
//   - o texto de nenhum slide pode repetir o CTA (saía "VER COMO" duas vezes);
//   - entre 3 e 8 slides — a Estratégia pode ajustar a quantidade do plano para caber a promessa.

const LIM_HEADLINE = 8;
const LIM_TEXTO = 12;
const MIN_SLIDES = 3;
const MAX_SLIDES = 8;
const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

function _palavras(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
function _sem(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

// Normaliza o que veio do agente: aceita [{headline,texto,visual}] ou [{titulo,texto}] ou ["..."].
function normalizarSlides(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => {
    if (typeof x === 'string') return { headline: x.trim(), texto: '', visual: '' };
    const o = x || {};
    return {
      headline: String(o.headline || o.titulo || o.title || '').trim(),
      texto: String(o.texto || o.subheadline || o.text || '').trim(),
      visual: String(o.visual || o.cena || '').trim(),
    };
  });
}

// Número que a capa promete ("5 sinais", "três erros") — 0 se não promete nenhum.
function numeroDaCapa(headline) {
  const t = _sem(headline);
  const m = t.match(/(^| )(\d{1,2})( |$)/);
  if (m) return Number(m[2]);
  const w = t.split(' ').find(p => NUMEROS[p]);
  return w ? NUMEROS[w] : 0;
}

// Problemas do roteiro de slides ('' = ok). `cta` = o cta_arte do post (não pode ser repetido).
function problemasSlides(slides, total, cta) {
  const s = normalizarSlides(slides);
  if (!s.length) return 'carrossel sem o roteiro dos slides ("slides": um item por slide — capa, desenvolvimento, fechamento)';
  if (s.length < MIN_SLIDES || s.length > MAX_SLIDES) return 'carrossel com ' + s.length + ' slides — precisa ter entre ' + MIN_SLIDES + ' e ' + MAX_SLIDES;
  const ctaN = _sem(cta);
  for (let i = 0; i < s.length; i++) {
    const it = s[i];
    if (!it.headline) return 'slide ' + (i + 1) + ' sem headline';
    if (_palavras(it.headline) > LIM_HEADLINE) return 'slide ' + (i + 1) + ': headline com ' + _palavras(it.headline) + ' palavras (máx ' + LIM_HEADLINE + ')';
    if (_palavras(it.texto) > LIM_TEXTO) return 'slide ' + (i + 1) + ': texto com ' + _palavras(it.texto) + ' palavras (máx ' + LIM_TEXTO + ')';
    if (ctaN && (_sem(it.texto) === ctaN || _sem(it.headline) === ctaN)) return 'slide ' + (i + 1) + ': o texto repete a chamada final ("' + cta + '") — ela já aparece no botão; escreva uma frase que explique o título';
    if (!it.visual) return 'slide ' + (i + 1) + ' sem "visual" (o objeto/cena que prova este slide)';
  }
  const iguais = new Set(s.map(it => it.headline.toLowerCase())).size;
  if (iguais < s.length) return 'slides com headline repetida — cada slide tem que avançar a história';
  const n = numeroDaCapa(s[0].headline), meio = s.length - 2;
  if (n && n !== meio) return 'a capa promete ' + n + ' ("' + s[0].headline + '"), mas há ' + meio + ' slide(s) de desenvolvimento — ajuste o número da capa ou a quantidade de slides (capa + ' + n + ' + fechamento = ' + (n + 2) + ' slides, máx ' + MAX_SLIDES + ')';
  return '';
}

// Texto que o worker entrega ao Engine para o slide n (1..total). Sem roteiro → null (o worker
// segue exatamente como antes: mesmo texto em todos os slides, carrosséis antigos não mudam).
// Prova só na capa; CTA só no último; "contexto" = a cena deste slide (vai no campo de contexto
// da legenda, que o Diretor usa para deduzir a cena — nunca é desenhado na arte).
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
    // o Engine corta esse contexto em 90 caracteres — curto de propósito
    contexto: it.visual ? ('Cena: ' + it.visual) : '',
  };
}

module.exports = { LIM_HEADLINE, LIM_TEXTO, MIN_SLIDES, MAX_SLIDES, normalizarSlides, numeroDaCapa, problemasSlides, textoDoSlide };
