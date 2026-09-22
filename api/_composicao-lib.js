// api/_composicao-lib.js — CAMADA DE COMPOSIÇÃO, FASE 1 (22/set/2026, autorizado pelo João)
// NÃO é uma serverless function (sem handler) — não conta no limite de funções da Vercel,
// mesmo padrão dos outros _xxx-lib.js deste diretório.
//
// O QUE ESTE ARQUIVO FAZ: o modelo de imagem gera cenário/luz/textura/pessoa (o que ele faz
// bem). Este arquivo compõe por cima, em PIXEL EXATO, o que precisa ser preciso: texto com a
// fonte real da marca (via opentype.js — contorno vetorial, JavaScript puro, sem depender de
// fontconfig/pango descobrirem a fonte no ambiente serverless) e o logo real (via sharp).
// Resolve texto derretido e logo torto. Prepara — não resolve ainda — fonte fora da marca
// (isso depende do DNA estar preenchido; ver ESTRUTURA-CODIGO / entrega própria do onboarding).
//
// PRINCÍPIO GOVERNANTE (Contrato de Engenharia, registrado): o DNA é a fonte única de toda
// decisão de marca. Os agentes gravam no onboarding (Identidade); este arquivo só LÊ. Reserva
// só na ausência, sempre com valores da própria plataforma, sempre com log — nunca decide a
// marca por conta própria. O que é MÉTODO (margem segura, contraste mínimo, hierarquia,
// limite de palavra) fica aqui, fixo, e vale para toda marca.
//
// Escopo desta fase: modo EDITORIAL, formatos feed (1080×1350) e story (1080×1920). Quadrado
// fora de escopo — não existe caminho de entrega para ele hoje (ver ACHADO abaixo). Modo CENA
// fica para a Fase 2 (texto sobre a cena, nunca sobre o rosto — o template precisa conhecer a
// posição do sujeito, o que esta fase não resolve).
//
// ACHADO REGISTRADO (21/set/2026, ainda válido): 'quadrado' não existe em nenhuma lista de
// FORMATOS_* (assets/classificacao.js) nem em nenhum HTML do produto, e o crop final do sharp
// em gerar-imagem.js é binário (_vert ? 1920 : 1350) — uma peça pedida em quadrado sai cortada
// em 1080×1350, nunca em 1080×1080. Rodada própria se o produto vier a precisar.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');

const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

// ═══════════════════════════════════════════════════════════════════════════
// RESERVA DA PLATAFORMA — só usada na AUSÊNCIA do DNA (fonte, cor). Nunca decide a marca;
// existe só para o pipeline nunca travar quando o onboarding ficou incompleto.
// ═══════════════════════════════════════════════════════════════════════════
const RESERVA_FONTES_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const RESERVA_ARQ = {
  primaria: 'BebasNeue-Regular.ttf',
  secundaria: 'Barlow-Regular.ttf',
  secundaria_semibold: 'Barlow-SemiBold.ttf',
};
const RESERVA_COR_FUNDO = '#050506';

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA DE FONTES — lê tipografia_primaria/secundaria do DNA (memorias, agente='global'),
// busca TTF real via Google Fonts Developer API (não a API de CSS — essa decide o formato por
// user-agent, o próprio opentype.js desaconselha depender disso), cacheia no Storage, serve do
// cache nas chamadas seguintes.
// ═══════════════════════════════════════════════════════════════════════════
const _cacheFontesProcesso = new Map(); // warm lambda: evita reler disco/rede dentro da mesma invocação

function _slugFonte(nome) {
  return String(nome || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function _lerReserva(papel) {
  const arq = RESERVA_ARQ[papel] || RESERVA_ARQ.secundaria;
  return fs.readFileSync(path.join(RESERVA_FONTES_DIR, arq));
}

async function _buscarFonteNaCacheStorage(slug) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/public/user-uploads/_fontes-cache/${slug}.ttf`);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return (buf && buf.length > 200) ? buf : null; // < 200 bytes não é um TTF válido, trata como cache-miss
  } catch (e) { return null; }
}

async function _gravarFonteNaCacheStorage(slug, buffer) {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/_fontes-cache/${slug}.ttf`, {
      method: 'POST',
      headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'font/ttf', 'x-upsert': 'true' },
      body: buffer,
    });
  } catch (e) { /* cache é otimização, nunca motivo de falha */ }
}

// Developer API (exige GOOGLE_FONTS_API_KEY na Vercel — o cliente provisiona). O campo `files`
// da resposta traz URL direta por variante ("regular", "700", "italic"...), já em TTF — sem
// conversão. Fonte variável (um único arquivo, sem peso por variante) ainda serve: opentype.js
// lê o outline estático na posição default do arquivo; só registramos em log que não havia peso.
async function _buscarFonteNoGoogleFonts(nomeFamilia, pesoDesejado) {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;
  if (!apiKey) return { erro: 'GOOGLE_FONTS_API_KEY não configurada na Vercel' };
  try {
    const r = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&family=${encodeURIComponent(nomeFamilia)}`);
    const d = await r.json().catch(() => null);
    const item = d && Array.isArray(d.items) && d.items[0];
    if (!item || !item.files) return { erro: `família "${nomeFamilia}" não encontrada no Google Fonts (confira grafia no onboarding)` };
    const variante = item.files[pesoDesejado] || item.files.regular || item.files['400'] || Object.values(item.files)[0];
    if (!variante) return { erro: `"${nomeFamilia}" sem nenhuma variante utilizável` };
    const rf = await fetch(String(variante).replace(/^http:/, 'https:'));
    if (!rf.ok) return { erro: `download de "${nomeFamilia}" falhou (HTTP ${rf.status})` };
    const buf = Buffer.from(await rf.arrayBuffer());
    if (!buf || buf.length < 200) return { erro: `"${nomeFamilia}" baixou um arquivo vazio/inválido` };
    return { buffer: buf };
  } catch (e) { return { erro: `erro de rede buscando "${nomeFamilia}": ${e.message}` }; }
}

// obterFonteBuffer: papel = 'primaria' | 'secundaria'. Retorna sempre um buffer utilizável —
// nunca lança, nunca devolve vazio. `logs` recebe uma linha sempre que a reserva é usada
// (sinal de onboarding incompleto, ou erro de digitação na fonte).
async function obterFonteBuffer(papel, nomeFamilia, { logs, userId } = {}) {
  const chaveLog = papel === 'primaria' ? 'tipografia_primaria' : 'tipografia_secundaria';
  if (!nomeFamilia || !String(nomeFamilia).trim()) {
    if (logs) logs.push(`[composicao/fontes] DNA sem ${chaveLog} (user ${userId || '?'}) — reserva da plataforma`);
    return { buffer: _lerReserva(papel), reserva: true, motivo: 'DNA vazio' };
  }
  const slug = _slugFonte(nomeFamilia);
  const memKey = papel + ':' + slug;
  if (_cacheFontesProcesso.has(memKey)) return _cacheFontesProcesso.get(memKey);

  const doCache = await _buscarFonteNaCacheStorage(slug);
  if (doCache) {
    const res = { buffer: doCache, reserva: false };
    _cacheFontesProcesso.set(memKey, res);
    return res;
  }
  const busca = await _buscarFonteNoGoogleFonts(nomeFamilia, papel === 'primaria' ? '700' : 'regular');
  if (busca.erro) {
    if (logs) logs.push(`[composicao/fontes] "${nomeFamilia}" (${chaveLog}, user ${userId || '?'}) — ${busca.erro} — reserva da plataforma`);
    return { buffer: _lerReserva(papel), reserva: true, motivo: busca.erro };
  }
  _gravarFonteNaCacheStorage(slug, busca.buffer); // não aguarda — cache é otimização
  const res = { buffer: busca.buffer, reserva: false };
  _cacheFontesProcesso.set(memKey, res);
  return res;
}

function _arrayBufferDoBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Verificação de glifos (1.3): confere que TODO caractere de `texto` existe na fonte antes de
// desenhar. Índice 0 em opentype.js é sempre .notdef (o "caractere ausente") — é o sinal.
function glifosFaltantes(fontOpentype, texto) {
  const faltam = [];
  for (const ch of String(texto || '')) {
    if (/\s/.test(ch)) continue;
    if (fontOpentype.charToGlyphIndex(ch) === 0) faltam.push(ch);
  }
  return faltam;
}

// carregarFonteParaTexto: obtém a fonte do DNA (ou reserva) E garante, ANTES de desenhar, que
// ela cobre 100% do texto pedido — senão troca para a reserva só para ESTE texto. Nunca deixa
// renderizar caixa vazia no lugar de letra.
async function carregarFonteParaTexto(papel, nomeFamilia, texto, { logs, userId } = {}) {
  const { buffer, reserva, motivo } = await obterFonteBuffer(papel, nomeFamilia, { logs, userId });
  let font = opentype.parse(_arrayBufferDoBuffer(buffer));
  if (!reserva) {
    const faltam = glifosFaltantes(font, texto);
    if (faltam.length) {
      if (logs) logs.push(`[composicao/fontes] "${nomeFamilia}" não tem os glifos [${faltam.join(' ')}] no texto "${String(texto).slice(0, 40)}" — trocando para a reserva só neste texto`);
      const bufRes = _lerReserva(papel);
      font = opentype.parse(_arrayBufferDoBuffer(bufRes));
      return { font, reserva: true, motivo: 'glifo ausente: ' + faltam.join(' ') };
    }
  }
  return { font, reserva, motivo };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTRASTE — WCAG AA (mínimo 4.5:1). Nunca falha silenciosamente: se nenhuma candidata
// atingir 4.5:1, devolve a de MAIOR contraste disponível (nunca aborta a peça por isso).
// ═══════════════════════════════════════════════════════════════════════════
function _hexParaRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (full.length !== 6 || isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function _canalLinear(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminanciaRelativa(hex) {
  const rgb = _hexParaRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * _canalLinear(rgb.r) + 0.7152 * _canalLinear(rgb.g) + 0.0722 * _canalLinear(rgb.b);
}
function contraste(hexA, hexB) {
  const l1 = luminanciaRelativa(hexA), l2 = luminanciaRelativa(hexB);
  const claro = Math.max(l1, l2), escuro = Math.min(l1, l2);
  return (claro + 0.05) / (escuro + 0.05);
}
// escolherCorTexto: primeira candidata que bate 4.5:1 contra o fundo real; senão a de maior
// contraste da lista, nunca uma cor fixa arbitrária escolhida sem checar.
function escolherCorTexto(candidatas, corFundo) {
  let melhorCor = '#FFFFFF', melhorRatio = -1, aa = false;
  for (const c of candidatas) {
    if (!c || !_hexParaRgb(c)) continue;
    const r = contraste(c, corFundo);
    if (r >= 4.5) return { cor: c, ratio: r, aa: true };
    if (r > melhorRatio) { melhorRatio = r; melhorCor = c; }
  }
  if (melhorRatio < 0) melhorRatio = contraste(melhorCor, corFundo);
  return { cor: melhorCor, ratio: melhorRatio, aa };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES — feed e story. Dimensões IDÊNTICAS ao crop final que o sharp já produz em
// gerar-imagem.js (linha ~896: `_vert ? {1920} : {1350}`) — não são valores novos inventados.
// Margens seguras herdadas do Engine 6.0 (gerar-imagem.js, seção "=== 12. SAFE ZONES ===");
// FEED/CAROUSEL usa a margem de feed, story usa a margem de REELS (story está em
// FORMATOS_VERTICAL, assets/classificacao.js).
//
// FEED: divisão esquerda/direita (texto/foto, 50/50) — segue a descrição textual de
// BLOCO_EDITORIAL (E1), escolha de desenho, não medida fixada em produção.
//
// STORY: CORRIGIDO (22/set/2026, revisão de design do João, achado 1) — o corte 50/50
// lado-a-lado, aplicado a um canvas 9:16, produzia duas colunas de 540×1920: o texto ficava
// espremido na largura e usava menos da metade da altura disponível (a origem do vazio
// apontado na amostra). Story passa a dividir em CIMA (foto, largura inteira) e EMBAIXO
// (texto, largura inteira).
// Os 13%/17% do João (margens seguras REELS, já existentes no Engine): aqui interpretados
// como restrição de CONTEÚDO (onde a IA deve evitar pôr o sujeito, e onde o código não pode
// desenhar nada importante) — não como um terceiro retângulo neutro sem dono. contTop/
// contBottom, abaixo, continuam aplicando exatamente essas margens ao conteúdo da zona de
// texto; a seção "SAFE ZONES" do Engine (inalterada) já instrui o modelo sobre o topo.
// Se a leitura pretendida era outra (retângulos deslocados fisicamente pelos 13%/17%,
// deixando uma faixa neutra), sinalizar — é reversível.
//
// zonaFoto.h=0.53 / zonaTexto.h=0.47 — AJUSTADO (22/set/2026, mesma rodada, ao gerar a primeira
// amostra REAL sobre foto de pessoa): a estimativa original (56/44, "44% ≈ 845px cabe
// confortavelmente todos os elementos") estava ERRADA — confundiu zonaTexto.h com a CAIXA ÚTIL
// de conteúdo de fato disponível, que é bem menor (contTopLimite começa DEPOIS de zonaTexto.y,
// com um respiro extra; contBottom pára na margem de 17%, fixa, independente de zonaTexto.h).
// A caixa real em 44% media ~461px, não ~845px. Com selo+headline+fio+subheadline+prova+CTA
// todos presentes (a amostra "com prova"), a pilha somava ~638px — estourava a caixa em ~177px,
// empurrando o CTA pra dentro da margem de 17% reservada à barra de resposta do Instagram.
// Dois ajustes juntos resolveram: (1) o `gap` entre elementos passou a ser proporção da CAIXA
// ÚTIL, não do canvas inteiro (ver comentário no `gap`, mais abaixo) — sozinho já reduziu o
// estouro de ~177px pra ~19px; (2) zonaTexto.h subiu de 0.44 pra 0.47 (zonaFoto desce de 0.56
// pra 0.53) — ainda MAIORIA fotografia real (LEI 0 do Diretor), mas com folga suficiente pra
// caber os 6 elementos sem vazar a margem segura. Verificado empiricamente gerando a amostra
// real (feed_dna_real_com_prova / story_dna_real_com_prova, ver relatório) — não é mais uma
// estimativa, é medido.
// ═══════════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  feed: {
    formato: 'feed', w: 1080, h: 1350,
    margens: { top: 0.09, lados: 0.08, bottom: 0.10 },
    zonaTexto: { x: 0, y: 0, w: 0.5, h: 1 },
    zonaFoto: { x: 0.5, y: 0, w: 0.5, h: 1 },
  },
  story: {
    formato: 'story', w: 1080, h: 1920,
    margens: { top: 0.13, lados: 0.08, bottom: 0.17 },
    zonaFoto: { x: 0, y: 0, w: 1, h: 0.53 },
    zonaTexto: { x: 0, y: 0.53, w: 1, h: 0.47 },
  },
};
function obterTemplate(vertical) { return vertical ? TEMPLATES.story : TEMPLATES.feed; }

// posição do logo (Parte 3 + ajuste do João, revisado 22/set/2026 "Engine 6.0 como caminho
// padrão" Rodada 1, item 2): tamanho ERA 15% da largura, herdado de comporLogoNaArte
// (agentes.html) — o próprio Engine 6.0 (gerar-imagem.js, texto de direção do canto) já
// especifica "about 18% of the width" para o canto calmo onde o logo real é colado depois.
// João pediu "tamanho conforme o Engine" — 18% é a fonte de verdade agora, não mais o valor
// herdado do navegador. A margem de 4% NÃO é herdada, porque antecede as margens seguras: no
// story, 4% da base caía dentro dos 17% cobertos pela barra de resposta do Instagram,
// escondendo o logo. Posição é sempre dentro da margem segura do template (canto inferior
// direito) — os mesmos 8%/10% (feed) e 8%/17% (story) que o Engine também especifica.
async function posicaoLogo(tpl, logoBuffer) {
  const meta = await sharp(logoBuffer).metadata();
  const lw = Math.round(tpl.w * 0.18);
  const lh = Math.round(lw * ((meta.height || 1) / (meta.width || 1)));
  const margemDireita = Math.round(tpl.w * tpl.margens.lados);
  const margemBase = Math.round(tpl.h * tpl.margens.bottom);
  return { left: tpl.w - lw - margemDireita, top: tpl.h - lh - margemBase, width: lw, height: lh };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYOUT DE TEXTO — medição e quebra de linha via opentype.js (advance width real da fonte,
// não uma estimativa), ajuste automático de tamanho para caber na caixa, até 3 linhas
// (headline). Nunca lança: no pior caso, devolve o tamanho mínimo mesmo sem caber perfeitamente
// — o gate de palavras (validarTextoDaPeca, já em produção) impede textos absurdamente longos
// de chegar até aqui.
// ═══════════════════════════════════════════════════════════════════════════
function quebrarLinhas(font, texto, tamanhoFonte, larguraMax, maxLinhas) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const tentativa = atual ? atual + ' ' + p : p;
    if (!atual || font.getAdvanceWidth(tentativa, tamanhoFonte) <= larguraMax) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = p;
      if (linhas.length >= maxLinhas) { atual = ''; break; }
    }
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  return linhas;
}
function _todasPalavrasCoube(texto, linhas) {
  const nOriginal = String(texto || '').split(/\s+/).filter(Boolean).length;
  const nColocado = linhas.join(' ').split(/\s+/).filter(Boolean).length;
  return nColocado >= nOriginal;
}
// _larguraMaximaDasLinhas: quebrarLinhas SEMPRE aceita a primeira palavra de uma linha nova,
// mesmo que ela sozinha já seja mais larga que larguraMax (senão travaria — não há como quebrar
// uma palavra sem espaço no meio). Isso é correto pra NUNCA travar, mas significa que uma linha
// "pronta" pode, na prática, estourar a largura da caixa — quem chama precisa CONFERIR, não
// assumir que quebrarLinhas garante o encaixe.
function _larguraMaximaDasLinhas(font, linhas, tamanhoFonte) {
  return linhas.reduce((max, l) => Math.max(max, font.getAdvanceWidth(l, tamanhoFonte)), 0);
}
function ajustarTamanhoAutomatico(font, texto, larguraMax, alturaMax, { inicial, minimo, maxLinhas, lineHeightMul = 1.15 }) {
  let tamanho = inicial;
  while (tamanho > minimo) {
    const linhas = quebrarLinhas(font, texto, tamanho, larguraMax, maxLinhas);
    const alturaTotal = linhas.length * tamanho * lineHeightMul;
    // BUG ENCONTRADO E CORRIGIDO (22/set/2026, mesma rodada, ao gerar a amostra de DNA simulado
    // com "Poppins" — uma fonte bem mais larga por caractere que a Bebas Neue da reserva): esta
    // função só conferia ALTURA total e CONTAGEM de palavras — nunca a LARGURA real de cada linha
    // já quebrada. quebrarLinhas aceita de propósito uma palavra sozinha numa linha nova mesmo que
    // ela already estoure larguraMax (é assim que evita travar — não dá pra quebrar uma palavra
    // sem espaço no meio dela); sem checar a largura aqui, esse "aceita mesmo estourando" passava
    // batido: o tamanho "cabia" pela altura, a palavra vazava a zona de texto, e o clipPath da
    // zona chapada cortava o glifo no meio — texto truncado, o mesmo tipo de defeito que a Fase 1
    // inteira existe pra eliminar (só que pela largura, não pelo desenho do modelo). Com Bebas
    // Neue (bem condensada) isso nunca aparecia nos testes; com uma fonte de largura normal
    // (Poppins/Barlow) apareceu na primeira amostra real. Agora exige LARGURA de cada linha
    // dentro de larguraMax também, não só altura/contagem.
    if (alturaTotal <= alturaMax && _todasPalavrasCoube(texto, linhas) && _larguraMaximaDasLinhas(font, linhas, tamanho) <= larguraMax) {
      return { tamanho, linhas };
    }
    tamanho -= 2;
  }
  // ÚLTIMO RECURSO: mesmo no tamanho mínimo de legibilidade, uma palavra isolada ainda pode ser
  // mais larga que a caixa (fonte larga + palavra longa). Continua encolhendo ABAIXO do mínimo só
  // como salva-vidas final, conferindo APENAS a largura — texto pequeno demais é preferível a
  // texto cortado no meio da palavra (nunca lança, nunca entrega glifo truncado).
  let tamanhoEmergencia = minimo - 2;
  while (tamanhoEmergencia > 10) {
    const linhas = quebrarLinhas(font, texto, tamanhoEmergencia, larguraMax, maxLinhas);
    if (_larguraMaximaDasLinhas(font, linhas, tamanhoEmergencia) <= larguraMax) return { tamanho: tamanhoEmergencia, linhas };
    tamanhoEmergencia -= 2;
  }
  return { tamanho: minimo, linhas: quebrarLinhas(font, texto, minimo, larguraMax, maxLinhas) };
}
// bloco de texto multi-linha, alinhado à esquerda — devolve o SVG (<path> por linha) e a altura ocupada.
function blocoTextoSvg(font, linhas, tamanhoFonte, x, yTopo, cor, lineHeightMul = 1.15) {
  const lineHeight = tamanhoFonte * lineHeightMul;
  let svg = '';
  linhas.forEach((linha, i) => {
    const yBaseline = yTopo + tamanhoFonte * 0.8 + i * lineHeight;
    const p = font.getPath(linha, x, yBaseline, tamanhoFonte);
    svg += `<path d="${p.toPathData(2)}" fill="${cor}"/>`;
  });
  return { svg, altura: linhas.length * lineHeight };
}
// pílula preenchida (selo do pilar, CTA) — retângulo arredondado + texto centralizado.
function pilulaSvg(font, texto, tamanhoFonte, x, yTopo, corFundo, corTexto, { paddingX = 26, paddingY = 16 } = {}) {
  const larguraTexto = font.getAdvanceWidth(texto, tamanhoFonte);
  const largura = Math.round(larguraTexto + paddingX * 2);
  const altura = Math.round(tamanhoFonte + paddingY * 2);
  const raio = Math.round(altura / 2);
  const textoX = x + paddingX;
  const textoYBaseline = yTopo + altura / 2 + tamanhoFonte * 0.34;
  const p = font.getPath(texto, textoX, textoYBaseline, tamanhoFonte);
  const svg = `<rect x="${x}" y="${yTopo}" width="${largura}" height="${altura}" rx="${raio}" ry="${raio}" fill="${corFundo}"/>`
    + `<path d="${p.toPathData(2)}" fill="${corTexto}"/>`;
  return { svg, largura, altura };
}
// prova como DADO EM DESTAQUE (22/set/2026, revisão de design do João, achado 4) — antes era
// uma pílula igual à do CTA, empilhada logo acima dela: duas formas iguais competindo, a prova
// lida como um segundo botão desabilitado. Engine já define prova como "a small highlighted
// stat or badge" — nunca um botão. Extrai um token numérico inicial (ex.: "+40" de "+40
// clientes atendidos") e desenha em destaque (cor de destaque, tamanho maior); o resto vira
// rótulo menor ao lado, na cor do texto normal. Sem número reconhecível, tudo vira rótulo — sem
// pílula em nenhum dos dois casos, forma sempre distinta do CTA.
function provaDestaqueSvg(fonteDestaque, fonteRotulo, texto, x, yTopo, corDestaque, corRotulo, tamanhoDestaque, tamanhoRotulo) {
  const m = String(texto || '').match(/^([+\-]?\d[\d.,%]*[a-zà-úA-ZÀ-Ú]*)\s+(.+)$/);
  const destaque = m ? m[1] : '';
  const rotulo = m ? m[2] : String(texto || '');
  let svg = '';
  let larguraDestaque = 0;
  if (destaque) {
    const yBaselineDestaque = yTopo + tamanhoDestaque * 0.8;
    const pD = fonteDestaque.getPath(destaque, x, yBaselineDestaque, tamanhoDestaque);
    svg += `<path d="${pD.toPathData(2)}" fill="${corDestaque}"/>`;
    larguraDestaque = fonteDestaque.getAdvanceWidth(destaque, tamanhoDestaque) + Math.round(tamanhoDestaque * 0.35);
  }
  const alturaBloco = destaque ? tamanhoDestaque : tamanhoRotulo;
  // rótulo alinhado pela base do destaque (ou pela própria base, se não há destaque) — nunca cai
  // fora do bloco visual, nunca cresce mais alto que o número em destaque.
  const yBaselineRotulo = yTopo + alturaBloco * 0.8;
  const pR = fonteRotulo.getPath(rotulo, x + larguraDestaque, yBaselineRotulo, tamanhoRotulo);
  svg += `<path d="${pR.toPathData(2)}" fill="${corRotulo}"/>`;
  return { svg, altura: Math.round(alturaBloco * 1.15), largura: larguraDestaque + fonteRotulo.getAdvanceWidth(rotulo, tamanhoRotulo) };
}
function _misturarComBranco(hex, fator) {
  const rgb = _hexParaRgb(hex) || { r: 5, g: 5, b: 6 };
  const mix = c => Math.round(c + (255 - c) * fator);
  return '#' + [mix(rgb.r), mix(rgb.g), mix(rgb.b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// compor() — o orquestrador. Lê o DNA (nunca decide marca), monta o SVG da zona chapada
// (fundo + gradiente + toda a hierarquia de texto) clipado exatamente ao retângulo da zona de
// texto (nunca toca a zona fotográfica — 2.4), compõe sobre a imagem do modelo com sharp, e
// compõe o logo por cima, por último, dentro da margem segura.
// ═══════════════════════════════════════════════════════════════════════════
async function compor({ imagemBase, vertical, M, conteudo, userId, logoBuffer, materialRealPreservado }) {
  const logs = [];
  const tpl = obterTemplate(vertical);
  const dna = M || {};
  const cont = conteudo || {};

  // ── cor de fundo da zona chapada (DNA → cor_fundo; reserva só na ausência, com log) ──
  const corFundoDNA = dna.cor_fundo && String(dna.cor_fundo).trim();
  const corFundo = corFundoDNA || RESERVA_COR_FUNDO;
  const usouReservaCorFundo = !corFundoDNA;
  if (usouReservaCorFundo) logs.push(`[composicao] DNA sem cor_fundo (user ${userId || '?'}) — reserva da plataforma (${RESERVA_COR_FUNDO}) — sinal de onboarding incompleto`);

  // ── cor do CTA (DNA → cor_cta; sem valor, deriva da paleta primária) ──
  // RESERVA CORRIGIDA (22/set/2026, revisão de design do João, achado 6): a reserva antiga,
  // '#D4AF37' (dourado), era uma decisão de marca escolhida em código — viola o Contrato de
  // Engenharia ("reserva sempre com os valores da própria plataforma"). A cor de destaque da
  // própria plataforma é o verde-limão '#BFFF00'.
  const RESERVA_COR_CTA = '#BFFF00';
  const corCtaDNA = dna.cor_cta && String(dna.cor_cta).trim();
  const corCta = corCtaDNA || (dna.paleta_primaria && String(dna.paleta_primaria).split(',')[0].trim()) || RESERVA_COR_CTA;
  const usouReservaCorCta = !corCtaDNA;
  if (usouReservaCorCta) logs.push(`[composicao] DNA sem cor_cta (user ${userId || '?'}) — derivada da paleta primária`);

  // ── fontes (DNA → Google Fonts → reserva; verificação de glifos por texto) ──
  const textoHeadline = String(cont.headline || '').toUpperCase();
  const { font: fontePrimaria, reserva: reservaPrimaria } = await carregarFonteParaTexto('primaria', dna.tipografia_primaria, textoHeadline, { logs, userId });
  const textoSecundariaAmostra = [cont.pilar, cont.subheadline, cont.prova, cont.cta].filter(Boolean).join(' ');
  const { font: fonteSecundaria, reserva: reservaSecundaria } = await carregarFonteParaTexto('secundaria', dna.tipografia_secundaria, textoSecundariaAmostra, { logs, userId });

  // ── geometria da zona de texto, em pixels ──
  // CORRIGIDO (22/set/2026, achado 1): a geometria agora reconhece as DUAS orientações de corte
  // possíveis — feed é esquerda/direita (zona de texto ocupa a ALTURA inteira, uma fatia da
  // largura); story é cima/baixo (zona de texto ocupa a LARGURA inteira, uma fatia da altura).
  // Detectado pela própria forma da zona (w>=1 → corte vertical), não por um campo novo.
  const zt = tpl.zonaTexto;
  const ztPx = { x: Math.round(zt.x * tpl.w), y: Math.round(zt.y * tpl.h), w: Math.round(zt.w * tpl.w), h: Math.round(zt.h * tpl.h) };
  const corteVertical = zt.w >= 0.999; // zona de texto ocupa a largura inteira → fronteira é horizontal (cima/baixo)
  const contX = Math.round(tpl.w * tpl.margens.lados);
  let contW, contTopLimite, contBottom;
  if (corteVertical) {
    // STORY: largura inteira menos as margens laterais; topo logo após a fronteira com a foto
    // (mais um respiro vertical — texto nunca encosta na foto), base na margem segura de baixo.
    const gutterV = Math.round(tpl.h * 0.03);
    contW = tpl.w - contX * 2;
    contTopLimite = ztPx.y + gutterV;
    contBottom = Math.round(tpl.h * (1 - tpl.margens.bottom));
  } else {
    // FEED: comportamento original — altura inteira menos as margens de topo/base; largura até
    // um respiro (gutter) antes da fronteira com a foto, à direita.
    const gutterH = Math.round(tpl.w * 0.06);
    contW = ztPx.x + ztPx.w - gutterH - contX;
    contTopLimite = Math.round(tpl.h * tpl.margens.top);
    contBottom = Math.round(tpl.h * (1 - tpl.margens.bottom));
  }

  // ── cor do texto por contraste calculado (2.3) — candidatas: paleta + branco/quase-preto.
  // Nunca decide uma cor fixa sem checar contra o fundo REAL. ──
  const candidatasTexto = [
    '#FFFFFF', '#0A0A0A',
    dna.paleta_primaria && String(dna.paleta_primaria).split(',')[0].trim(),
    dna.paleta_secundaria && String(dna.paleta_secundaria).split(',')[0].trim(),
  ].filter(Boolean);
  const { cor: corTexto } = escolherCorTexto(candidatasTexto, corFundo);
  // cor do texto dentro do CTA: mesma regra, contra o fundo do CTA — se falhar, troca o texto, nunca o corCta (2.3).
  const { cor: corTextoCta } = escolherCorTexto(['#FFFFFF', '#0A0A0A'], corCta);

  // ── monta a hierarquia, de cima para baixo, empilhando só o que existe (2.2) — CORRIGIDO
  // (22/set/2026, achado 2): cursor começa em 0 RELATIVO (não em contTopLimite) — o bloco
  // inteiro é centralizado opticamente dentro da caixa útil depois de montado (ver o offset
  // mais abaixo), em vez de ficar sempre colado no topo com a metade de baixo vazia. Escolhi
  // centralizar em vez de ancorar o CTA separado na base porque, em peças sem prova/subheadline,
  // ancorar o CTA sozinho lá embaixo deixaria um vão desconexo entre ele e o resto do bloco —
  // centralizado, a peça lê como composta em qualquer combinação de elementos presentes.
  // Aplicado também ao story (não só ao feed, que foi o que o João apontou) — por consistência:
  // os dois formatos ficariam com comportamento diferente um do outro senão.
  //
  // alturaCaixaUtil movida pra ANTES da pilha (era calculada só depois, na versão anterior) —
  // achado NESTA MESMA RODADA, ao gerar a amostra de story com todos os elementos presentes
  // (selo+headline+fio+subheadline+prova+CTA): o `gap` era uma fração do CANVAS inteiro
  // (tpl.h*0.018), não da caixa útil de conteúdo — em story, a caixa útil (461px, depois de
  // aplicar o gutter e a margem de 17%) é bem menor que 44% do canvas (845px) sugeria, mas o gap
  // em pixels absolutos era MAIOR que no feed (35px vs 24px) por ser proporcional ao canvas
  // inteiro (1920 vs 1350), não à caixa. Resultado: com todos os elementos presentes, a pilha
  // somava ~640px de altura — estourava a caixa de 461px, empurrando o CTA pra baixo da margem
  // segura de 17% (a peça vazaria pra dentro da barra de resposta do Instagram). Gap agora é uma
  // fração da CAIXA ÚTIL (alturaCaixaUtil*0.035), não do canvas — encolhe automaticamente quando a
  // caixa é menor, sem depender de quantos elementos a peça tem.
  const alturaCaixaUtil = contBottom - contTopLimite;
  let cursorY = 0;
  const gap = Math.max(4, Math.round(alturaCaixaUtil * 0.035));
  let corpoSvg = '';

  if (cont.pilar) {
    const selo = pilulaSvg(fonteSecundaria, String(cont.pilar).toUpperCase(), Math.round(tpl.w * 0.028), contX, cursorY, corCta, corTextoCta);
    corpoSvg += selo.svg;
    cursorY += selo.altura + gap * 1.4;
  }

  if (textoHeadline) {
    const alturaDisponivelHeadline = Math.round(tpl.h * (vertical ? 0.22 : 0.26));
    const { tamanho, linhas } = ajustarTamanhoAutomatico(fontePrimaria, textoHeadline, contW, alturaDisponivelHeadline, {
      inicial: Math.round(tpl.w * 0.11), minimo: Math.round(tpl.w * 0.045), maxLinhas: 3, lineHeightMul: 1.02,
    });
    const bloco = blocoTextoSvg(fontePrimaria, linhas, tamanho, contX, cursorY, corTexto, 1.02);
    corpoSvg += bloco.svg;
    cursorY += bloco.altura + gap;
  }

  if (cont.subheadline || cont.headline) {
    // fio de destaque — linha fina, cor de destaque, ~10% da largura do CANVAS (não da zona), mesma
    // proporção que M3/E4 já usam para o mesmo elemento quando o próprio modelo desenhava.
    const fioW = Math.round(tpl.w * 0.10);
    const fioEspessura = 3;
    corpoSvg += `<rect x="${contX}" y="${cursorY}" width="${fioW}" height="${fioEspessura}" fill="${corCta}"/>`;
    cursorY += fioEspessura + gap * 1.4;
  }

  if (cont.subheadline) {
    const { tamanho, linhas } = ajustarTamanhoAutomatico(fonteSecundaria, String(cont.subheadline), contW, Math.round(tpl.h * 0.09), {
      inicial: Math.round(tpl.w * 0.034), minimo: Math.round(tpl.w * 0.024), maxLinhas: 2,
    });
    const bloco = blocoTextoSvg(fonteSecundaria, linhas, tamanho, contX, cursorY, corTexto);
    corpoSvg += bloco.svg;
    cursorY += bloco.altura + gap * 1.4;
  }

  if (cont.prova) {
    // CORRIGIDO (22/set/2026, achado 4): dado em destaque, não mais uma pílula igual à do CTA.
    const prova = provaDestaqueSvg(fontePrimaria, fonteSecundaria, String(cont.prova), contX, cursorY, corCta, corTexto, Math.round(tpl.w * 0.05), Math.round(tpl.w * 0.024));
    corpoSvg += prova.svg;
    cursorY += prova.altura + gap * 1.4;
  }

  // (alturaCaixaUtil já calculada mais acima, antes da pilha — ver comentário do `gap`)
  // BUG ENCONTRADO E CORRIGIDO NESTA MESMA RODADA (22/set/2026, ao gerar as amostras da revisão
  // de design — não fazia parte dos 6 achados do João, apareceu na amostra de story com prova):
  // o CTA tinha uma âncora PRÓPRIA, sobrevivente da versão anterior ao achado 2 (quando o bloco
  // não centralizava e o CTA tentava ficar perto da base por conta própria, via
  // `Math.min(cursorY, alturaCaixaUtil - alturaCta)`). Depois do achado 2 (bloco inteiro
  // centralizado como uma unidade, via <g transform> mais abaixo), essa âncora antiga virou
  // perigosa: sempre que a pilha anterior (selo+headline+fio+subheadline+prova) já passava do
  // limiar "alturaCaixaUtil - alturaCta", o Math.min escolhia o valor MENOR — ou seja, jogava o
  // CTA pra TRÁS na pilha, por cima do que já tinha sido desenhado (a prova, no caso da amostra
  // de story), em vez de deixá-lo nascer depois. Texto sobreposto e ilegível é pior que estourar
  // levemente a margem segura por baixo — removida a âncora própria: o CTA agora empilha como
  // qualquer outro elemento (mesmo padrão de prova/subheadline), e o offset de centralização
  // (calculado uma vez, sobre a altura total real do bloco) cuida de toda a posição de uma vez.
  if (cont.cta) {
    const cta = pilulaSvg(fonteSecundaria, String(cont.cta).toUpperCase(), Math.round(tpl.w * 0.03), contX, cursorY, corCta, corTextoCta, { paddingX: 30, paddingY: 18 });
    corpoSvg += cta.svg;
    cursorY += cta.altura + gap;
  }

  // ── centralização óptica: desloca o bloco inteiro (ainda em coordenadas relativas) pro meio
  // vertical da caixa útil, nunca menos que o topo dela (conteúdo que já enche a caixa fica
  // colado no topo, como antes — nunca estoura por cima). ──
  const offsetCentralizacao = Math.max(0, Math.round((alturaCaixaUtil - cursorY) / 2));
  const corpoSvgPosicionado = `<g transform="translate(0, ${contTopLimite + offsetCentralizacao})">${corpoSvg}</g>`;

  // ── fundo da zona chapada: UM único retângulo preenchido pelo gradiente `fusaoZona` — opaco
  // (stop-opacity 1) na maior parte da zona, perdendo opacidade (stop-opacity → 0) só na borda
  // que encosta na foto — a própria zona fotográfica nunca é pintada (2.4). CORRIGIDO (22/set/2026,
  // achado 3): a versão anterior desenhava um retângulo SÓLIDO opaco por baixo do retângulo do
  // gradiente — como os dois ficam dentro do MESMO SVG, rasterizado como UMA única camada antes
  // de ir para o .composite() do sharp, a "transparência" do gradiente revelava o retângulo sólido
  // por baixo (a própria corFundo, sem variação), nunca a foto de verdade — o bug não teria
  // corrigido a faixa clara, só trocado por outro defeito equivalente. Removido o retângulo sólido:
  // agora só existe o retângulo do gradiente, então onde ele chega a stop-opacity 0 o PIXEL da
  // camada SVG fica de fato transparente, e é a foto (camada de baixo no sharp .composite()) que
  // aparece — fusão contínua, sem faixa e sem borda dura. Antes disso, a versão original (ainda
  // anterior) clareava para uma cor sólida (corClara) nos últimos 22%, criando a própria faixa
  // clara com borda dura que o achado 3 apontou. Distância da fusão limitada a 8% (em vez de 22%)
  // quando há material real preservado — a foto embaixo pode ser o próprio sujeito travado pelo
  // contrato de preservação, e revelar menos dela reduz o risco de expor parte dele por essa borda;
  // sem material real (cenário 100% gerado pela IA) a fusão mais generosa (22%) fica livre. ──
  const distanciaFusao = materialRealPreservado ? 0.08 : 0.22;
  const fadePct = Math.round((1 - distanciaFusao) * 100);
  const gradAttrs = corteVertical ? 'x1="0%" y1="0%" x2="0%" y2="100%"' : 'x1="0%" y1="0%" x2="100%" y2="0%"';
  const gradStops = corteVertical
    // vertical (story): fusão no TOPO da zona (onde ela encosta na foto, acima) — transparente
    // no topo (revela a foto), opaca a partir de `distanciaFusao` da altura da zona pra baixo.
    ? `<stop offset="0%" stop-color="${corFundo}" stop-opacity="0"/>
       <stop offset="${Math.round(distanciaFusao * 100)}%" stop-color="${corFundo}" stop-opacity="1"/>
       <stop offset="100%" stop-color="${corFundo}" stop-opacity="1"/>`
    // horizontal (feed): fusão na DIREITA da zona (onde ela encosta na foto) — opaca até
    // `fadePct`, depois perde opacidade até o fim (revela a foto).
    : `<stop offset="0%" stop-color="${corFundo}" stop-opacity="1"/>
       <stop offset="${fadePct}%" stop-color="${corFundo}" stop-opacity="1"/>
       <stop offset="100%" stop-color="${corFundo}" stop-opacity="0"/>`;
  const fundoSvg = `<defs>
      <clipPath id="clipZonaTexto"><rect x="${ztPx.x}" y="${ztPx.y}" width="${ztPx.w}" height="${ztPx.h}"/></clipPath>
      <linearGradient id="fusaoZona" ${gradAttrs}>
        ${gradStops}
      </linearGradient>
    </defs>
    <g clip-path="url(#clipZonaTexto)">
      <rect x="${ztPx.x}" y="${ztPx.y}" width="${ztPx.w}" height="${ztPx.h}" fill="url(#fusaoZona)"/>
      ${corpoSvgPosicionado}
    </g>`;

  const svgFinal = `<svg width="${tpl.w}" height="${tpl.h}" xmlns="http://www.w3.org/2000/svg">${fundoSvg}</svg>`;

  const composicoes = [{ input: Buffer.from(svgFinal), left: 0, top: 0 }];
  if (logoBuffer) {
    try {
      const posLogo = await posicaoLogo(tpl, logoBuffer);
      const logoRedimensionado = await sharp(logoBuffer).resize(posLogo.width, posLogo.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
      composicoes.push({ input: logoRedimensionado, left: posLogo.left, top: posLogo.top });
    } catch (e) { logs.push(`[composicao] logo não pôde ser composto: ${e.message} — peça sai sem logo, nunca trava a entrega`); }
  }

  const buffer = await sharp(imagemBase)
    .resize(tpl.w, tpl.h, { fit: 'cover', position: 'attention' })
    .composite(composicoes)
    .jpeg({ quality: 88, chromaSubsampling: '4:2:0' })
    .toBuffer();

  return { buffer, logs, usouReservaFonte: reservaPrimaria || reservaSecundaria, usouReservaCorFundo, usouReservaCorCta };
}

module.exports = {
  TEMPLATES, obterTemplate, posicaoLogo,
  obterFonteBuffer, carregarFonteParaTexto, glifosFaltantes,
  luminanciaRelativa, contraste, escolherCorTexto,
  quebrarLinhas, ajustarTamanhoAutomatico,
  RESERVA_COR_FUNDO,
  compor,
};
