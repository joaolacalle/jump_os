// api/gerar-imagem.js — Geração de criativos via OpenAI gpt-image-1
// Aceita foto real do cliente (image-to-image) quando disponível
// ENV: OPENAI_API_KEY, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({ 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'application/json' });
// FONTE ÚNICA de classificação de conteúdo — ver assets/classificacao.js. Aqui só o
// enquadramento vertical (reel/story) é consultado; este endpoint gera imagem para qualquer
// formato recebido, nunca decide se algo é produzível (Fase 1, 25/ago/2026).
const JC = require('../assets/classificacao.js');
// CAMADA DE COMPOSIÇÃO (22/set/2026, Fase 1, autorizado pelo João) — módulo helper, sem handler
// próprio (não conta no limite de funções da Vercel, mesmo padrão dos outros _xxx-lib.js).
// obterTemplate/posicaoLogo (22/set/2026, "Engine 6.0 como caminho padrão" Rodada 1, item 2):
// já existiam exportados, só não eram importados aqui — reaproveitados para colar o logo real
// no caminho PADRÃO (fora do interruptor de composição), ver o novo passo depois do corte.
const { compor, obterTemplate, posicaoLogo, carregarFonteParaTexto, pilulaSvg, escolherCorTexto } = require('./_composicao-lib.js');
// FONTE ÚNICA DO DNA OBRIGATÓRIO (22/set/2026, "Engine 6.0 Rodada 2", Causa 2, autorizado pelo
// João) — ver api/_dna-lib.js. Aqui só LEITURA/sinalização (log + conteudos.meta.dna_incompleto,
// mais abaixo); nunca grava nada no DNA do cliente — preencher é exclusividade do onboarding.
const { dnaFaltando } = require('./_dna-lib.js');

const VERSAO = '2026.09.25-cta-e-selo-devolvidos-ao-modelo-area-util-declarada';

// ── SLIDES DE CARROSSEL ───────────────────────────────────────────────────────
// O schema (perguntado ao banco, nunca inferido) NÃO tem coluna de slides:
// `midia_url` é TEXT — UMA imagem por conteúdo. O parâmetro `slide` viajava até aqui,
// o Engine 6.0 tinha a regra de carrossel... e o slide 2 SOBRESCREVIA o midia_url do
// slide 1. Carrossel nunca existiu: era um post com uma imagem chamado de carrossel.
// SEM MIGRATION: `meta` é jsonb default '{}' — os slides moram em meta.slides.
// `midia_url` continua sendo a CAPA (slide 1), então tudo que já lê midia_url
// (calendário, dashboard, histórico, publicação no Instagram) segue funcionando.
// CUIDADO: PATCH em jsonb SUBSTITUI o objeto inteiro — tem que ler, mesclar e gravar,
// senão apaga meta.headline e meta.oferta (seria a 5ª vez do mesmo tipo de erro).
async function gravarSlide(conteudoId, url, slide, total) {
  if (!conteudoId || !url) return;
  const n = Math.max(1, Number(slide) || 1);
  const tot = Math.max(1, Number(total) || 1);
  const patch = { status: 'aguardando_aprovacao' };
  if (n === 1) patch.midia_url = url; // a capa continua onde todo mundo já procura
  try {
    if (tot > 1) {
      const atual = await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudoId}&select=meta`, { headers: SBH() })
        .then(r => r.json()).then(a => (Array.isArray(a) && a[0] ? (a[0].meta || {}) : {})).catch(() => ({}));
      const slides = Array.isArray(atual.slides) ? atual.slides.slice() : [];
      const i = slides.findIndex(x => Number(x && x.n) === n);
      const item = { n, url, em: new Date().toISOString() };
      if (i >= 0) slides[i] = item; else slides.push(item);
      slides.sort((a, b) => Number(a.n) - Number(b.n));
      patch.meta = { ...atual, slides, total_slides: tot }; // mescla: preserva headline/oferta
    }
  } catch (e) { console.error('gravarSlide meta:', e.message); }
  await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudoId}`, {
    method: 'PATCH', headers: SBH(), body: JSON.stringify(patch),
  }).catch(() => {});
}

// registrarFalhaComposicaoNaOrdem (22/set/2026, "composição — Fase 1", defeitos de design,
// condição confirmada pelo João sobre a falha do compositor): "registro visível na ordem, com o
// motivo" — console.error sozinho só é visível a quem abre o log da Vercel, não a quem olha o
// conteúdo. Mesmo cuidado de gravarSlide: `meta` é jsonb, PATCH substitui o objeto inteiro —
// lê, mescla, grava, nunca apaga headline/oferta/slides já presentes. Nunca lança: registrar a
// falha é auditoria, não pode ela própria travar a resposta ao cliente.
async function registrarFalhaComposicaoNaOrdem(conteudoId, motivo) {
  await mesclarMetaNaOrdem(conteudoId, { composicao_falha: { motivo: String(motivo || '').slice(0, 500), em: new Date().toISOString() } });
}

// mesclarMetaNaOrdem (22/set/2026, "Engine 6.0 como caminho padrão", Rodada 1, item 4) —
// generaliza o padrão read-merge-write que gravarSlide e registrarFalhaComposicaoNaOrdem já
// usavam cada um por conta própria: meta é jsonb, PATCH substitui o objeto inteiro, então todo
// escritor precisa ler o meta atual, mesclar por cima e só então gravar — nunca gravar direto
// (senão apaga headline/oferta/slides já presentes, mesma família de erro já corrigida antes
// neste arquivo). patchParcial é mesclado no NÍVEL RAIZ do meta atual — mesma semântica que
// registrarFalhaComposicaoNaOrdem já tinha. Nunca lança: registrar metadado é auditoria, não
// pode travar a resposta ao cliente.
async function mesclarMetaNaOrdem(conteudoId, patchParcial) {
  if (!conteudoId) return;
  try {
    const atual = await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudoId}&select=meta`, { headers: SBH() })
      .then(r => r.json()).then(a => (Array.isArray(a) && a[0] ? (a[0].meta || {}) : {})).catch(() => ({}));
    const meta = { ...atual, ...patchParcial };
    await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudoId}`, {
      method: 'PATCH', headers: SBH(), body: JSON.stringify({ meta }),
    }).catch(() => {});
  } catch (e) { console.error('[meta] mesclarMetaNaOrdem:', e.message); }
}

// BUG (Arte 3): a copy era cortada com slice(0,90) NO MEIO DA FRASE e o gerador
// renderizava o toco verbatim ("...A diferença entre" e parava). Corta na última
// frase completa; se não houver, na última palavra inteira. Nunca no meio.
function cortarFrase(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const p = Math.max(c.lastIndexOf('. '), c.lastIndexOf('! '), c.lastIndexOf('? '));
  if (p > max * 0.4) return c.slice(0, p + 1).trim();
  const e = c.lastIndexOf(' ');
  return (e > 0 ? c.slice(0, e) : c).trim();
}

// ── ETAPA 1 — TEXTO VALIDADO EM CÓDIGO (16/set/2026, "Engine — Etapas 1 e 2") ──
// Antes o limite de palavras só existia como PROSA dentro do prompt do Diretor de Arte
// ("se a headline exceder 8 palavras, reescreva") — nenhuma contagem real acontecia em
// código; um headline de 20 palavras passava batido até a arte sair errada, e o Diretor
// (um modelo de texto) tinha que decidir o que aparecia na peça, o que não é trabalho dele.
// MESMO PADRÃO de cardinalidade() (api/agente-chat.js): lança Error controlado, a chamadora
// nunca corrige/trunca/reescreve em silêncio — recusa e avisa, com o campo e a contagem na
// mensagem. Este arquivo é o ÚNICO funil por onde toda geração de imagem passa (chat avulso,
// ordem de serviço, worker do cron, ordem do Tráfego) — validar aqui cobre TODO caminho de
// uma vez, incluindo o gap do itens[] (agentes.html manda it.headline||'' sem checar nada).
// LIMITES: vêm do próprio engine6() (seção "=== 2. WORD LIMIT ==="), nunca reinventados aqui:
// headline máx 8 palavras, subheadline (= SUPPORT COPY do Engine) máx 6, cta_arte (= CTA) máx 2.
// PROVA não tem limite de palavras em lugar nenhum do Engine — só um corte de 90 caracteres na
// montagem do prompt (linha do PROOF POINT, função engine6) — por isso NÃO valida contagem de
// palavras de prova: inventar um limite que a lei do Engine não define seria a mesma falha que
// esta etapa está corrigindo (regra nova sem fonte). HEADLINE é sempre obrigatória (é o elemento
// dominante da peça, nunca pode faltar) — vazia é recusada como qualquer estouro de limite,
// EXCETO na exceção nomeada dos dois ramos de fallback do laço de ordens em agentes.html (ver
// permitirInvencaoHeadline nos dois pontos onde diretorDeArte é chamado, mais abaixo): ali não
// existe nenhum agente decidindo o texto antes de chegar aqui, e o próprio Diretor escreve a
// headline a partir do tema cru — comportamento assumido, registrado, nunca o padrão geral.
function contarPalavras(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}
function validarTextoDaPeca(o, permitirHeadlineVazia) {
  const h = String(o.headline || '').trim();
  if (!h) {
    if (permitirHeadlineVazia) return; // exceção nomeada: o Diretor escreve a headline
    throw new Error('headline vazia — este é o elemento de texto dominante da peça (campo obrigatório do Engine 6.0).');
  }
  const nH = contarPalavras(h);
  if (nH > 8) throw new Error('headline com ' + nH + ' palavras (limite do Engine: 8) — "' + h + '"');
  if (o.subheadline) {
    const nS = contarPalavras(o.subheadline);
    if (nS > 6) throw new Error('subheadline com ' + nS + ' palavras (limite do Engine: 6) — "' + o.subheadline + '"');
  }
  if (o.cta_arte) {
    const nC = contarPalavras(o.cta_arte);
    if (nC > 2) throw new Error('cta_arte com ' + nC + ' palavras (limite do Engine: 2) — "' + o.cta_arte + '"');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONA DE EXCLUSÃO EFETIVA (22/set/2026, "Engine 6.0 Rodada 2", Causa 1, autorizado pelo
// João) — o Engine sempre declarou margens seguras como "percentual do canvas", mas o canvas
// que o Engine descrevia era o canvas GERADO (o.canvas, ex. 1024x1536) — nunca o canvas que
// o cliente final vê. Entre a geração e a entrega, o crop (`sharp`, fit:'cover', ver mais
// abaixo) descarta uma faixa do topo/base (feed) ou dos lados (story) pra encaixar 2:3 em
// 4:5/9:16. O Engine nunca sabia disso: media as margens dentro da região que seria cortada
// fora — é a causa raiz do botão cortado ao meio e do elemento decepado que o João relatou.
// calcularZonaExclusao() traduz margensBase (frações do canvas ENTREGUE, os mesmos números de
// sempre) em margens EFETIVAS sobre o canvas GERADO — soma o descarte do crop à margem base,
// escalada pela fração que sobrevive ao corte. FONTE ÚNICA: tanto o texto do prompt (engine6,
// seção 12, abaixo) quanto o crop de verdade (mais abaixo no handler) usam o MESMO par alvo
// {w,h} e a MESMA saída desta função — nunca dois números divergentes pra mesma peça.
const MARGENS_BASE_SAFE_ZONE = {
  feed:  { top: 0.09, sides: 0.08, bottom: 0.10 }, // FEED/CAROUSEL — números originais do Engine
  reels: { top: 0.13, sides: 0.08, bottom: 0.17 }, // REELS/STORY — números originais do Engine
};

// Reproduz a matemática do `fit:'cover'` do sharp: escala a imagem gerada (genW x genH) até
// cobrir o alvo (alvoW x alvoH) nos dois eixos, e informa quanto sobra pra cortar fora em CADA
// eixo. A divisão por 2 assume corte CENTRALIZADO — é exatamente o que a Causa 1 pede
// (position:'center' no crop de verdade, não mais 'attention'/saliência).
function calcularZonaExclusao(genW, genH, alvoW, alvoH, margensBase) {
  if (!genW || !genH || !alvoW || !alvoH || !margensBase) return null;
  const escala = Math.max(alvoW / genW, alvoH / genH);
  const escaladoW = genW * escala, escaladoH = genH * escala;
  const corteW = Math.max(0, escaladoW - alvoW);
  const corteH = Math.max(0, escaladoH - alvoH);
  const fracCorteW = escaladoW ? corteW / escaladoW : 0; // fração do eixo LARGURA descartada
  const fracCorteH = escaladoH ? corteH / escaladoH : 0; // fração do eixo ALTURA descartada
  const descartePorLado = fracCorteW / 2;  // esquerda E direita, corte centralizado
  const descartePorBorda = fracCorteH / 2; // topo E base, corte centralizado
  const larguraEntregueFracao = 1 - fracCorteW;
  const alturaEntregueFracao = 1 - fracCorteH;
  return {
    descarteLargura: fracCorteW,
    descarteAltura: fracCorteH,
    descartePorLado,
    descartePorBorda,
    // margem efetiva sobre o CANVAS GERADO = a fatia já descartada pelo corte + a margem base
    // do Engine, escalada pra valer dentro da região que de fato sobrevive ao corte.
    margemTopoGerado:  descartePorBorda + margensBase.top * alturaEntregueFracao,
    margemBaseGerado:  descartePorBorda + margensBase.bottom * alturaEntregueFracao,
    margemLadosGerado: descartePorLado + margensBase.sides * larguraEntregueFracao,
  };
}
const fmtPct = (f) => (Math.round(f * 10000) / 100) + '%';

// ═══════════════════════════════════════════════════════════════════════════
// ZONAS RESERVADAS DAS PÍLULAS (24/set/2026, "Trocar o motor de imagem e reservar as zonas das
// pílulas", decisão 5, autorizado pelo João) — Achado adicional da ordem: o selo "OFERTA" saiu
// POR CIMA da headline numa peça (24/set 21:32) porque o Engine nunca declarou ao modelo que as
// duas áreas onde o código carimba CTA/selo (ver bloco de composição, mais abaixo, dentro de
// `if (!logoJaComposta)`) estão reservadas — já faz isso pro canto do logo (seção 4 BRANDING),
// faltava para as pílulas. FUNÇÃO IRMÃ de calcularZonaExclusao (acima), NUNCA dentro dela — esta
// rodada não altera calcularZonaExclusao (está na lista do que não muda: "corte determinístico e
// safe zones"). mapearRetParaGerado traduz um retângulo do canvas ENTREGUE (onde as pílulas
// realmente ficam) para frações do canvas GERADO (onde o modelo de imagem desenha, ANTES do
// corte) — mesma matemática de fit:'cover' com corte centralizado que calcularZonaExclusao já usa
// para margens uniformes, aqui generalizada para um retângulo qualquer.
function mapearRetParaGerado(genW, genH, alvoW, alvoH, ret) {
  if (!genW || !genH || !alvoW || !alvoH || !ret) return null;
  const escala = Math.max(alvoW / genW, alvoH / genH);
  const escaladoW = genW * escala, escaladoH = genH * escala;
  const offX = (escaladoW - alvoW) / 2, offY = (escaladoH - alvoH) / 2;
  return {
    x0: (ret.x + offX) / escala / genW,
    y0: (ret.y + offY) / escala / genH,
    x1: (ret.x + ret.w + offX) / escala / genW,
    y1: (ret.y + ret.h + offY) / escala / genH,
  };
}
// calcularZonasPills — FONTE ÚNICA da geometria das duas pílulas (selo e CTA) que o código
// carimba por código, por cima da peça já cortada. Extraída do bloco que já existia (Rodada
// "Foto travada de verdade, CTA e selo por código", 24/set/2026) para poder rodar CEDO — antes de
// montar qualquer prompt — e alimentar tanto a declaração ao modelo (engine6, seção 4 BRANDING)
// quanto o desenho de verdade (mais abaixo, dentro de `if (!logoJaComposta)`), que passa a REUSAR
// este mesmo resultado em vez de recalcular. Comportamento — textos, fontes, cores, posições,
// fallbacks — byte a byte o mesmo que já existia: SÓ o lugar onde a conta roda mudou (Invariante
// em risco da ordem: "as coordenadas das zonas reservadas e as do compositor são a MESMA fonte").
async function calcularZonasPills(vert, M6, pilar, ctaArte, total, targetId) {
  const seloTexto = String(pilar || M6.marca || '').trim();
  const ctaTexto = String(ctaArte || '').trim() || (Number(total) > 1 ? 'SWIPE →' : '');
  if (!seloTexto && !ctaTexto) return null;
  const tpl = obterTemplate(vert);
  const corCtaDna = M6.cor_cta && String(M6.cor_cta).trim();
  const corCta = corCtaDna || (M6.paleta_primaria && String(M6.paleta_primaria).split(',')[0].trim()) || '#BFFF00';
  const { cor: corTextoCta } = escolherCorTexto(['#FFFFFF', '#0A0A0A'], corCta);
  const textoAmostra = [seloTexto, ctaTexto].filter(Boolean).join(' ');
  const { font } = await carregarFonteParaTexto('secundaria', M6.tipografia_secundaria, textoAmostra, { userId: targetId });
  const contX = Math.round(tpl.w * tpl.margens.lados);
  const topoY = Math.round(tpl.h * tpl.margens.top);
  const baseY = Math.round(tpl.h * (1 - tpl.margens.bottom));
  let selo = null, cta = null;
  if (seloTexto) {
    const r = pilulaSvg(font, seloTexto.toUpperCase(), Math.round(tpl.w * 0.028), contX, topoY, corCta, corTextoCta);
    selo = { x: contX, y: topoY, w: r.largura, h: r.altura, svg: r.svg };
  }
  if (ctaTexto) {
    const paddingXCta = 30, paddingYCta = 18, tamanhoCta = Math.round(tpl.w * 0.03);
    const alturaCta = Math.round(tamanhoCta + paddingYCta * 2);
    const r = pilulaSvg(font, ctaTexto.toUpperCase(), tamanhoCta, contX, baseY - alturaCta, corCta, corTextoCta, { paddingX: paddingXCta, paddingY: paddingYCta });
    cta = { x: contX, y: baseY - alturaCta, w: r.largura, h: r.altura, svg: r.svg };
  }
  return { tpl, selo, cta };
}

// ═══════════════════════════════════════════════════════════════════════════
// JUMP OS — CONTENT ENGINE 6.0 VISUAL (BLOCO IMUTÁVEL)
// Este engine NÃO pode ser resumido, encurtado nem reescrito por nenhum agente.
// Os agentes só PREENCHEM as variáveis (tema/headline/copy) — o resto é lei.
// ═══════════════════════════════════════════════════════════════════════════
function engine6(M, o) {
  const P1 = M.paleta_primaria || '', P2 = M.paleta_secundaria || '', P3 = M.paleta_terciaria || '';
  const CTA = M.cor_cta || P1 || '';
  const T1 = M.tipografia_primaria || '', T2 = M.tipografia_secundaria || '';
  const DNA = M.dna_visual || M.estilo_visual || '';
  // Campos novos do Script A (via Identidade) — refinam a direção de arte de cada marca.
  const estFoto = M.estilo_fotografico || '', composic = M.tipo_de_composicao || '', agress = M.nivel_de_agressividade || '';
  const obrig = M.elementos_obrigatorios || '', proib = M.elementos_proibidos || '';
  const corFundo = M.cor_fundo || '';
  // DNA DA MARCA — camada VISUAL_SYSTEM (23/set/2026, autorizado pelo João). Estes 5 campos têm
  // PRECEDÊNCIA sobre o derivado genérico do enum — quando existem, a linha genérica correspondente
  // é suprimida (nunca as duas ao mesmo tempo; ver cada uso abaixo, seções 5/6/7/8/11/13).
  const densVisual = M.densidade_visual || '';
  const contraste = M.tipo_de_contraste || '';
  const modoHumanoVS = M.vs_modo_humano || '';
  const focoVS = M.vs_controle_foco_fotografico || '';
  const hierarquiaVS = M.vs_hierarquia_visual || '';
  const profVS = M.vs_profundidade_visual || '';
  // Campos declarativos do "segundo bloco do OS_DATA" — só emitidos quando a marca preencheu;
  // marca sem eles continua caindo nos genéricos (_dna-lib.js não muda; nada aqui é obrigatório).
  const estruturaCampos = [
    densVisual ? ('Visual density (brand-declared): ' + densVisual + '.') : '',
    composic ? ('Composition type: ' + composic + ' — lay the piece out this way.') : '',
    contraste ? ('Contrast: ' + contraste + ' — calibrate contrast to this, independent of visual energy/aggressiveness below.') : '',
    M.temperatura_cromatica ? ('Color temperature: ' + M.temperatura_cromatica + '.') : '',
    M.estilo_visual_descricao ? ('Visual style, in the brand\'s own words: ' + M.estilo_visual_descricao + '.') : '',
    M.estilo_de_copy ? ('Copy style: ' + M.estilo_de_copy + '.') : '',
    M.tom_do_cta ? ('CTA tone: ' + M.tom_do_cta + '.') : '',
    M.estilo_iconografico ? ('Iconographic style: ' + M.estilo_iconografico + '.') : '',
    // 23/set/2026 (decisão 5 da rodada anterior, autorizado pelo João): a peça de teste saiu com
    // a tela do notebook ilegível, um borrão — objeto pequeno e distante o gerador não consegue
    // desenhar legível. Escala mínima declarada junto do estilo, não um bloco à parte.
    // 24/set/2026 ("Regeneração dirigida, defeito visível e cena que não se repete", decisão 4,
    // autorizado pelo João): a regra virou CONDICIONAL — antes disparava sempre que a MARCA
    // tinha estilo_de_mockup preenchido no DNA, mesmo em peças cuja cena não tem nenhum motivo
    // pra incluir tela (causa apontada da monotonia visual — luminária/notebook/caneca em toda
    // peça). engine6() não decide a cena (isso é do Diretor, mais abaixo) — não há como o código
    // saber aqui se ESTA peça terá tela; a condição vira instrução explícita pro modelo deduzir
    // da própria cena, mesmo padrão já usado em BLOCO_CENA S1b ("se o tema for software... telas
    // reais"). Desvio sinalizado no relatório: as outras 9 correções desta e da rodada anterior
    // preferiram mecanismo a prosa — aqui não há mecanismo possível sem um passo novo de
    // verificação pós-geração (fora do escopo pedido, que só cita "engine6(): a linha de mockup
    // vira condicional").
    M.estilo_de_mockup ? ('Mockup style, ONLY IF this piece\'s own scene actually includes a screen or software interface (deduce that from the theme — a screen/mockup is NOT mandatory in every piece; never force one into a scene that has no real reason for it): ' + M.estilo_de_mockup + '. When it does apply, give it real scale: at least 25% of the piece\'s area, with the screen/label content clearly legible — never small or distant enough that the generator can\'t render it readable.') : '',
    M.momento_negocio ? ('Business moment: ' + M.momento_negocio + '.') : '',
    M.objetivo_conteudo ? ('Content objective: ' + M.objetivo_conteudo + '.') : '',
    M.sempre_fazer ? ('Always do: ' + M.sempre_fazer + '.') : '',
    M.nunca_fazer ? ('Never do: ' + M.nunca_fazer + '.') : '',
  ].filter(Boolean);
  // VISUAL_SYSTEM: varre QUALQUER chave vs_* do DNA em vez de consumir lista fixa — campo novo
  // aparece no prompt sem deploy. Descartado o mapa hardcoded (vs_comportamento_headline →
  // "Headline behavior", no exemplo do João): a configuração campo a campo dos agentes já está
  // planejada e cada campo novo viraria alteração de código. Rótulo derivado mecanicamente da
  // própria chave (remove o prefixo vs_, troca _ por espaço, maiúscula só na primeira letra) —
  // fica em português, na ordem da chave, não traduzido/reordenado como no exemplo dele; sinalizado
  // como desvio no relatório desta entrega. .sort() garante prompt determinístico (a ordem que
  // chega do banco não é garantida).
  // 23/set/2026 (decisão 8, autorizado pelo João): as 4 chaves abaixo têm seção PRÓPRIA (5, 6, 8,
  // 11) que já as substitui no lugar do genérico — sem esta exclusão, cada uma aparecia DUAS
  // vezes no prompt (aqui, na varredura, e de novo na seção dedicada). Excluídas só da varredura
  // genérica; a substituição na seção própria continua valendo normalmente.
  const VS_COM_SECAO_PROPRIA = ['vs_modo_humano', 'vs_controle_foco_fotografico', 'vs_hierarquia_visual', 'vs_profundidade_visual'];
  const visualSystemLinhas = Object.keys(M)
    .filter(k => k.indexOf('vs_') === 0 && VS_COM_SECAO_PROPRIA.indexOf(k) === -1 && String(M[k] == null ? '' : M[k]).trim())
    .sort()
    .map(k => {
      const rotulo = k.slice(3).replace(/_/g, ' ');
      return rotulo.charAt(0).toUpperCase() + rotulo.slice(1) + ': ' + M[k];
    });
  const paleta = [P1, P2, P3].filter(Boolean).join(', ');
  const reels = JC.ehVertical(o.formato || '');
  const intens = (M.intensidade_visual || 'MEDIA').toUpperCase();
  const vazio = { BAIXA: '70%', MEDIA: '55-60%', 'MÉDIA': '55-60%', ALTA: '40-50%', EXTREMA: '25-35%' }[intens] || '55-60%';
  const elems = { MINIMAL: '2-4', BALANCED: '4-7', DENSE: '8-12' }[(M.complexidade_visual || 'BALANCED').toUpperCase()] || '4-7';
  const temp = (M.temperatura_emocional || 'PREMIUM').toUpperCase();
  const estilo = (M.estilo_visual || 'EDITORIAL').toUpperCase();
  // O OS_DATA já guarda tudo isto (memórias globais gravadas pelo Identidade) — só não
  // estava chegando à arte. É o que torna a peça do dentista diferente da do restaurante.
  const negocio = [
    M.marca ? ('Brand: ' + M.marca) : '',
    M.nicho ? ('Niche / industry: ' + M.nicho) : '',
    M.produtos_precos ? ('What they sell: ' + String(M.produtos_precos).slice(0, 220)) : '',
    M.publico_alvo ? ('Audience: ' + String(M.publico_alvo).slice(0, 180)) : '',
    M.posicionamento ? ('Positioning: ' + String(M.posicionamento).slice(0, 180)) : '',
    M.arquetipo ? ('Brand archetype: ' + M.arquetipo) : '',
  ].filter(Boolean).join('\n');

  // ÁREA ÚTIL, DECLARADA COMO ÁREA (25/set/2026, "Devolver CTA e selo ao modelo, e declarar a
  // área útil de verdade", decisão 3, autorizado pelo João) — a seção 12 sempre descreveu as
  // margens como PROIBIÇÃO ("não coloque texto importante aqui") e o modelo continuava compondo
  // até a borda; a peça de 25/set 12:47 mostrou que ele obedece de fato uma instrução AFIRMATIVA
  // ("componha tudo dentro deste retângulo"). Mesmos números de sempre (o.regiaoEntregue, FONTE
  // ÚNICA com o corte real — calcularZonaExclusao, nunca alterada nesta rodada) — só a FRASE virou
  // positiva: o retângulo útil é o complemento das margens já calculadas, nunca um número novo.
  const areaUtil = o.regiaoEntregue ? {
    x0: fmtPct(o.regiaoEntregue.margemLadosGerado), x1: fmtPct(1 - o.regiaoEntregue.margemLadosGerado),
    y0: fmtPct(o.regiaoEntregue.margemTopoGerado), y1: fmtPct(1 - o.regiaoEntregue.margemBaseGerado),
  } : null;
  // Fallback defensivo (sem o.regiaoEntregue — nunca deveria disparar em produção, mesmo padrão já
  // usado no restante da seção 12): mesmos números-base de MARGENS_BASE_SAFE_ZONE, únicos e já
  // existentes, nunca um segundo par hand-typed.
  const margensBaseFallback = MARGENS_BASE_SAFE_ZONE[reels ? 'reels' : 'feed'];
  const areaUtilFallback = {
    x0: fmtPct(margensBaseFallback.sides), x1: fmtPct(1 - margensBaseFallback.sides),
    y0: fmtPct(margensBaseFallback.top), y1: fmtPct(1 - margensBaseFallback.bottom),
  };

  return [
    'You are an art director creating premium Instagram content following a professional design system. Execute EVERY rule below — they are non-negotiable.',
    reels ? 'FORMAT: vertical 1080x1920 single frame.' : 'FORMAT: Instagram feed/carousel slide.',
    o.total > 1 ? ('CAROUSEL slide ' + (o.slide || 1) + ' of ' + o.total + ': keep grid, composition, lighting, hierarchy, palette, intensity, complexity and temperature IDENTICAL to the other slides. Change ONLY label, headline, specific visual element and support copy.') : '',
    '',
    '=== 1. LOCKED PALETTE (CRITICAL) ===',
    paleta ? ('Use EXCLUSIVELY these colors: ' + paleta + '. CTA color: ' + CTA + ' with locked saturation.' + (corFundo ? (' Background color: ' + corFundo + ' — dominant background tone and the color of any flat/solid zone. NEVER applied over the photographic layer: a real scene keeps its own real tones.') : '') + ' Validate before rendering: am I using ONLY these colors? If an external color appears, STOP and fix.') : 'Use a restrained, consistent premium palette (max 3 colors).',
    T1 || T2 ? ('Typography: headline in ' + (T1 || 'a bold grotesque') + ' Bold; support copy in ' + (T2 || T1 || 'a clean sans') + '.') : '',
    DNA ? ('Brand visual DNA: ' + DNA) : '',
    // CONTEXTO DE NEGÓCIO: sem isto o diretor inventa cenário genérico. Com isto, a cena
    // nasce do mundo real do cliente (consultório, oficina, cozinha, escritório, estúdio...).
    negocio ? ('=== BUSINESS CONTEXT (the scene must belong to THIS world) ===\n' + negocio + '\nEvery physical element you choose — environment, props, textures, wardrobe, objects — must plausibly belong to this business. A generic office/laptop scene is a failure unless this business IS an office business.') : '',
    // BRAND STRUCTURE & DENSITY (23/set/2026, "DNA da marca — camada VISUAL_SYSTEM", autorizado
    // pelo João): segundo bloco do OS_DATA — densidade, composição, contraste e o resto dos campos
    // declarativos da marca. tipo_de_composicao mora só aqui agora (saiu do bloco BRAND VISUAL
    // RULES logo abaixo, que também o emitia — duas linhas pedindo a mesma coisa duas vezes).
    estruturaCampos.length ? ('=== BRAND STRUCTURE & DENSITY (the client\'s own declared density and composition — obey them) ===\n' + estruturaCampos.join('\n')) : '',
    // BRAND VISUAL RULES: os campos novos do DNA que direcionam fotografia e elementos.
    [estFoto, agress, obrig, proib].some(Boolean) ? ('=== BRAND VISUAL RULES (from the client\'s DNA — obey them) ===\n' + [
      estFoto ? ('Photographic style: ' + estFoto + ' — any photographic layer must follow it.') : '',
      // 23/set/2026: contraste deixou de vir daqui — agora é tipo_de_contraste, campo próprio da
      // marca (bloco acima), independente da energia/agressividade. As duas eram calibradas juntas
      // e se anulavam quando a marca queria contraste alto com energia baixa (ou o oposto).
      agress ? ('Visual energy / aggressiveness: ' + agress + ' — calibrate scale and tension to this.') : '',
      obrig ? ('ALWAYS include these brand elements: ' + obrig + '.') : '',
      proib ? ('NEVER include these elements: ' + proib + '.') : '',
    ].filter(Boolean).join('\n')) : '',
    // BRAND VISUAL SYSTEM: varredura genérica de vs_* — ver o comentário de visualSystemLinhas
    // acima. 23/set/2026 (correção da decisão 8): os 4 campos com seção própria (vs_modo_humano,
    // vs_controle_foco_fotografico, vs_hierarquia_visual, vs_profundidade_visual — VS_COM_SECAO_
    // PROPRIA) NÃO aparecem mais aqui — só na seção dedicada de cada um (5/6/8/11), onde
    // substituem a linha genérica. Antes apareciam nas DUAS, duas vezes o mesmo dado no prompt.
    visualSystemLinhas.length ? ('=== BRAND VISUAL SYSTEM (the client\'s own design system — obey it) ===\n' + visualSystemLinhas.join('\n')) : '',
    '',
    // COMPOSIÇÃO ATIVA (22/set/2026, Fase 1): quando o código vai desenhar todo o texto e a
    // logo por cima (ver _composicao-lib.js), instruir o modelo a também tentar renderizar
    // texto é o que causa o "texto derretido" que essa infraestrutura existe pra resolver —
    // seções 2/3/5/10 (word limit, label, reading priority, anti-glitch) inteiras ficam sem
    // sentido (não há texto do modelo para limitar/le­gibilizar) e são suprimidas; a 4
    // (branding) e o bloco final ("CONTENT OF THIS PIECE") são substituídos por uma versão que
    // NUNCA pede texto renderizado — ver o ternário de cada linha abaixo.
    // 23/set/2026 ("Corte, mockup e teto de texto", decisão 2, autorizado pelo João): a peça de
    // teste saiu com ~45% de ocupação contra 68% declarado, faltando os módulos secundários que
    // a marca pede como obrigatórios (capturas de tela, blocos modulares). O teto de palavras
    // sempre foi lido pelo modelo como teto da CENA inteira — inclusive texto que pertence a um
    // OBJETO da cena (tela de software, quadro branco) — o que sufoca a densidade que o DNA pede.
    // Copy de apoio sobe de 6 para 12 (referência aprovada usa 10); headline (8) e CTA (2) ficam.
    // Teto total ajustado de 18 para 22 pra continuar sendo a soma real dos três (8+12+2), não um
    // número solto que já não batia antes (8+6+2=16) nem bateria agora (8+12+2=22 > 18 antigo).
    o.composicaoAtiva ? '' : '=== 2. WORD LIMIT (MAXIMUM 22 VISIBLE WORDS OF PIECE TEXT) ===',
    // CTA E SELO POR CÓDIGO (24/set/2026, decisão 4, autorizado pelo João): quando o.ctaSeloPorCodigo,
    // CTA e selo saem da conta do modelo inteiramente — o texto passa a descrever só headline e
    // support copy, nunca menciona um limite de palavras pro CTA (ele não vai desenhar nenhum).
    o.composicaoAtiva ? '' : (o.ctaSeloPorCodigo
      ? 'This limit is for the PIECE\'S OWN TEXT ONLY — headline and support copy. The CTA button and the category label (selo) are composed separately, by code — do not render them, they are not part of this limit. HEADLINE max 8 words · SUPPORT COPY max 12 words.'
      : 'This limit is for the PIECE\'S OWN TEXT ONLY — headline, support copy, CTA (label does not count, graphic element). HEADLINE max 8 words · SUPPORT COPY max 12 words · CTA max 2 words.'),
    o.composicaoAtiva ? '' : 'Text that belongs to an OBJECT represented in the scene — a software screen, a whiteboard, a book spine, a mug, a sign, a handwritten note — is a VISUAL ELEMENT, not piece text: it does NOT count toward this limit. This is exactly what makes a dense, populated scene possible without inflating the copy.',
    o.composicaoAtiva ? '' : 'If the piece text does not fit: 1st remove support copy, 2nd shorten headline. LESS piece text > MORE piece text.',
    '',
    // CTA E SELO POR CÓDIGO (decisão 4): o selo (label) some da conta do modelo tanto quanto o
    // CTA — a seção inteira não tem sentido quando quem desenha o selo é código, depois do corte.
    (o.composicaoAtiva || o.ctaSeloPorCodigo) ? '' : '=== 3. EVIDENT LABEL ===',
    (o.composicaoAtiva || o.ctaSeloPorCodigo) ? '' : ('The label reads like a small editorial title: immediate visual prominence, 8-12% of composition width, contrast 7:1 minimum, color ' + (CTA || 'the CTA color') + ', highlighted position, never blended into the background.'),
    '',
    '=== 4. BRANDING ===',
    // 23/set/2026 (decisão 4, autorizado pelo João): a proibição era ampla demais — proibia
    // QUALQUER símbolo/ícone, mesmo quando outro bloco (estilo_iconografico, elementos_obrigatorios
    // com "capturas reais de tela") pedia exatamente isso. Agora escopada à MARCA: só o símbolo/
    // logo/emblema/monograma/assinatura QUE REPRESENTA a marca é proibido. Ícone funcional e
    // pictograma da cena (ícone de UI numa tela, diagrama, pictograma técnico) deixam de ser
    // proibidos e seguem estilo_iconografico quando a marca declarar.
    o.composicaoAtiva
      ? 'The system composes the brand name, headline, subheadline, proof, CTA and the real logo on top of what you generate — BY CODE, not by you. Do NOT render, write, letter, stencil, engrave or draw the brand name, any word or digit, or this BRAND\'s own logo/symbol/emblem/monogram/watermark, anywhere in the image. Functional icons and pictograms that belong to the SCENE (UI icons on a screen, a diagram, a technical pictogram) are allowed and should follow estilo_iconografico when the brand declares it — they are not this brand\'s mark.'
      : ('ALLOWED: brand name as plain text, minimalist typographic signature; functional icons and pictograms that belong to the scene (UI icons on a screen, a diagram, a technical pictogram) — follow estilo_iconografico when the brand declares it. FORBIDDEN, as THIS BRAND\'s own mark: a graphic symbol, icon-style logo, crest, emblem, complex monogram, or invented handwritten signature representing the brand itself.'
          // CTA E SELO POR CÓDIGO (decisão 4): a mesma proibição explícita que a seção acima já usa
          // pro nome/logo da marca, agora também para o botão de CTA e o selo — os dois passam a
          // ser compostos por código, depois do corte (ver ponto de composição em gerar-imagem.js).
          + (o.ctaSeloPorCodigo ? ' The system also composes the CTA button/pill and the category label (selo) on top of what you generate — BY CODE, not by you, after this image is cropped. Do NOT render, write, letter, stencil or draw any call-to-action button, pill, badge or category label anywhere in the image — leave that space to the system.' : '')),
    o.composicaoAtiva
      ? 'Keep the entire LEFT HALF of the canvas (full height) visually calm and simple — the system will completely cover it with the brand\'s text. Never place a face, product detail or anything important there; treat it as background only. The RIGHT HALF is where the real photographic scene lives.'
      : 'Keep the BOTTOM-RIGHT corner (about 18% of the width) visually calm — no important text, no focal element there. The real brand logo (a PNG) is composited into that corner by the system after generation.',
    // ZONAS RESERVADAS DAS PÍLULAS (24/set/2026, decisão 5, autorizado pelo João) — mesma
    // mecânica da linha do canto do logo, acima: quando o.ctaSeloPorCodigo, o sistema também
    // carimba por código o selo (categoria) e o botão de CTA, em retângulos exatos calculados
    // pela MESMA função (calcularZonasPills) que desenha de verdade mais abaixo — nunca um número
    // aproximado hand-typed aqui. Ausente quando não há texto de selo/CTA nesta peça (zonasPills
    // null) ou quando composicaoAtiva (compor() já reserva o espaço à sua própria maneira).
    (!o.composicaoAtiva && o.ctaSeloPorCodigo && o.zonasPills && (o.zonasPills.selo || o.zonasPills.cta))
      ? ('The system also reserves two exact rectangles, by code, for the CTA button/pill and the category label (selo) it stamps there after this image is cropped — same mechanism as the logo corner above. Do NOT place important text, a focal element or anything visually busy inside them: '
          + [
              o.zonasPills.selo ? ('SELO/LABEL zone — horizontally ' + fmtPct(o.zonasPills.selo.x0) + ' to ' + fmtPct(o.zonasPills.selo.x1) + ', vertically ' + fmtPct(o.zonasPills.selo.y0) + ' to ' + fmtPct(o.zonasPills.selo.y1) + '.') : '',
              o.zonasPills.cta ? ('CTA zone — horizontally ' + fmtPct(o.zonasPills.cta.x0) + ' to ' + fmtPct(o.zonasPills.cta.x1) + ', vertically ' + fmtPct(o.zonasPills.cta.y0) + ' to ' + fmtPct(o.zonasPills.cta.y1) + '.') : '',
            ].filter(Boolean).join(' '))
      : '',
    '',
    o.composicaoAtiva ? '' : '=== 5. READING PRIORITY ===',
    // vs_hierarquia_visual (23/set/2026): substitui os percentuais fixos quando a marca declara
    // a própria hierarquia — a linha genérica abaixo não é emitida junto.
    o.composicaoAtiva ? '' : (hierarquiaVS
      ? ('This brand\'s own reading priority: ' + hierarquiaVS + '. No element may compete above the headline\'s own share.')
      : 'Headline ALWAYS dominant (50-60% of attention) > visual (30-40%) > label (5-10%) > copy+CTA (5-10%). No element may compete above 50% with the headline.'),
    '',
    // MATERIAL REAL PRESERVADO (21/set/2026, mesma rodada do contrato reescrito): esta seção era
    // incondicional — engine6 não recebia sinal nenhum de material preservado — e pedia luz
    // direcional + sombra profunda SEMPRE sobre a camada fotográfica. Quando essa camada É o
    // material preservado (pessoa/produto real), isso reintroduzia exatamente a reiluminação que
    // o contrato agora proíbe. o.materialReal (novo, setado pelos call sites) condiciona a regra:
    // sem material, texto idêntico ao de sempre; com material, a luz/sombra dirigida passa a valer
    // só para o AMBIENTE ao redor, nunca sobre o que está preservado.
    '=== 6. PHOTOGRAPHIC FOCUS CONTROL ===',
    // vs_controle_foco_fotografico (23/set/2026, correção da decisão 7 desta rodada): a versão
    // anterior só trocava o fragmento "luminosity 60-70% max" e mantinha o resto da frase genérica
    // ao redor — o valor da marca entrava NO MEIO da frase e repetia "controlled contrast"/
    // "directional lighting" ao lado do que a marca já tinha declarado. Agora substitui a frase
    // INTEIRA (as duas variantes, com/sem material real) quando a marca declara o próprio controle.
    o.materialReal
      ? (focoVS
          ? ('Photography SUPPORTS the headline, never competes: this brand\'s own photographic focus control: ' + focoVS + '. Gaze/product pointing toward the headline, subtly blurred background AROUND the preserved subject. The directional light and deep shadow this rule asks for belong to the ENVIRONMENT around the preserved material, never to the material itself — the preserved subject or product keeps exactly the light it already has in the original photo. An over-lit photo competes with the headline — avoid.')
          : ('Photography SUPPORTS the headline, never competes: controlled medium contrast, luminosity 60-70% max, gaze/product pointing toward the headline, subtly blurred background AROUND the preserved subject. The directional light and deep shadow this rule asks for belong to the ENVIRONMENT around the preserved material, never to the material itself — the preserved subject or product keeps exactly the light it already has in the original photo. An over-lit photo competes with the headline — avoid.'))
      : (focoVS
          ? ('Photography SUPPORTS the headline, never competes: this brand\'s own photographic focus control: ' + focoVS + '. Gaze/product pointing toward the headline, subtly blurred background. An over-lit photo competes with the headline — avoid.')
          : ('Photography SUPPORTS the headline, never competes: controlled medium contrast (not hyper-detailed), directional lighting (never flat), luminosity 60-70% max, strategic deep shadow areas, gaze/product pointing toward the headline, subtly blurred background. An over-lit photo competes with the headline — avoid.')),
    '',
    '=== 7. MANDATORY NEGATIVE SPACE ===',
    // densidade_visual (23/set/2026): substitui o % de vazio derivado de intensidade quando a
    // marca declara a própria densidade — a linha genérica (mapa BAIXA/MEDIA/ALTA/EXTREMA) não
    // é emitida junto. Sem conversão aritmética do valor declarado (formato é da marca, não do
    // código) — ver ressalva no relatório desta entrega.
    densVisual
      ? (o.composicaoAtiva
          ? ('This brand\'s own visual density: ' + densVisual + ' — build the photographic (right) zone to this density, not the generic empty-space mapping. Minimum 5% height of breathing room around any visual element, margins always respected.')
          : ('This brand\'s own visual density: ' + densVisual + ' — build the piece to this density, not the generic empty-space mapping. Breathing room around the headline (never touch it with elements), minimum 5% height between elements, margins always respected.'))
      : (o.composicaoAtiva
          ? ('Leave ' + vazio + ' empty within the photographic (right) zone. Do NOT fill every area — empty space has narrative function. Minimum 5% height of breathing room around any visual element, margins always respected.')
          : ('Leave ' + vazio + ' empty. Do NOT fill every area — empty space has narrative function. Breathing room around the headline (never touch it with elements), minimum 5% height between elements, margins always respected.')),
    '',
    '=== 8. VISUAL DEPTH (ANTI-FLAT) — 3 MANDATORY LAYERS ===',
    // vs_profundidade_visual (23/set/2026): substitui o CONTEÚDO fixo das 3 camadas quando a
    // marca declara a própria profundidade — as 3 camadas continuam obrigatórias (estrutura não
    // muda), só o que vai em cada uma passa a vir do valor declarado.
    profVS
      ? ('3 layers remain mandatory (foreground / midground / background) — this brand\'s own layer content: ' + profVS + '. Subtle shadows (stickers 10-15% opacity, 8px offset), controlled overlap, selective background blur.')
      : 'FOREGROUND: light overlays, sticker cutouts, opacity 80-100%. MIDGROUND: headline, photo, labels, copy, CTA, opacity 100%. BACKGROUND: base, subtle textures, technical grid, opacity 20-60%. Subtle shadows (stickers 10-15% opacity, 8px offset), controlled overlap, selective background blur.',
    '',
    '=== 9. VISUAL MOVEMENT ===',
    o.composicaoAtiva
      ? 'Eye flow across the photographic zone leads naturally toward the LEFT edge, where the brand text will be composited by the system afterwards. Strategic diagonals, gaze/product pointing left, progressive contrast (brighter/sharper near the left edge, softer toward the right).'
      : ('Eye flow: headline → visual → label → CTA. Strategic diagonals, human gaze pointing to headline/CTA, subtle arrows in ' + (CTA || 'CTA color') + ' (2-3px stroke), progressive contrast (max at headline, decreasing on details).'),
    '',
    o.composicaoAtiva ? '' : '=== 10. TEXT TREATMENT (ANTI-GLITCH) ===',
    o.composicaoAtiva ? '' : 'Portuguese text 100% correct (ç ã õ é á), perfectly legible, clean alignment, no deformation, no fused or melted letters, no wrong line breaks, consistent kerning, readable on mobile.',
    '',
    '=== 11. HUMAN MODE ===',
    // vs_modo_humano (23/set/2026, correção da decisão 6 desta rodada): substitui "grain 2-5%,
    // noise 1-3%..." quando a marca declara o próprio modo humano — mas a salvaguarda "NEVER
    // artificial, exaggerated or forced vintage" tinha sumido JUNTO com o genérico na primeira
    // versão desta substituição. Ela é o que impede o modelo de exagerar um grain de 8% (o valor
    // real declarado pela conta de teste) até virar vintage forçado — continua sendo emitida nos
    // dois casos agora.
    modoHumanoVS
      ? ('This brand\'s own human-mode treatment: ' + modoHumanoVS + '. NEVER artificial, exaggerated or forced vintage — apply it subtly. Goal: a real campaign, not an AI render.')
      : 'Subtly add: grain 2-5%, noise 1-3%, light print texture, organic micro-wear. NEVER artificial, exaggerated or forced vintage. Goal: a real campaign, not an AI render.',
    '',
    '=== 12. SAFE ZONES ===',
    'CANVAS (real output): ' + (o.canvas || '1024x1536 portrait (2:3)') + '. Compose for THIS exact canvas — do not assume any other aspect ratio.',
    // Causa 1, Rodada 2 (22/set/2026, autorizado pelo João): o Engine sempre disse "percent
    // of the canvas" pensando no canvas ENTREGUE, mas isto sempre descreveu o canvas GERADO —
    // que passa por um crop determinístico antes de chegar ao cliente (ver calcularZonaExclusao
    // acima). Com o.regiaoEntregue calculado (handler sempre calcula hoje), a região realmente
    // entregue é declarada explicitamente e as margens passam a ser as EFETIVAS sobre o canvas
    // gerado — não mais os números-base isolados. Sem o.regiaoEntregue (defensivo — nunca deve
    // faltar em produção), cai nos números-base antigos, sem o ajuste do corte.
    (o.regiaoEntregue && o.alvoRecorte)
      ? ('DELIVERED REGION: after you finish, this canvas is CROPPED to a fixed ' + o.alvoRecorte.w + 'x' + o.alvoRecorte.h + ' — a deterministic CENTER crop (not saliency-based: the exact same central region is kept every time). '
          + (o.regiaoEntregue.descarteAltura > 0.001 ? ('The TOP and BOTTOM bands are discarded, ' + fmtPct(o.regiaoEntregue.descartePorBorda) + ' each (' + fmtPct(o.regiaoEntregue.descarteAltura) + ' of height, total). ') : '')
          + (o.regiaoEntregue.descarteLargura > 0.001 ? ('The LEFT and RIGHT bands are discarded, ' + fmtPct(o.regiaoEntregue.descartePorLado) + ' each (' + fmtPct(o.regiaoEntregue.descarteLargura) + ' of width, total). ') : '')
          + 'Compose so every element that matters — header, footer, CTA, anything near an edge — survives fully inside the surviving central region. Anything placed in the discarded bands is LOST, not just partially cropped.')
      : '',
    (areaUtil)
      ? ('USEFUL AREA on THIS generated canvas (already accounts for the crop above — these are NOT the same numbers as the delivered piece\'s own safe zones): compose the ENTIRE piece — headline, copy, CTA, label, everything — inside this rectangle: horizontally from ' + areaUtil.x0 + ' to ' + areaUtil.x1 + ' of the canvas width, vertically from ' + areaUtil.y0 + ' to ' + areaUtil.y1 + ' of the canvas height. Anything placed OUTSIDE this rectangle is LOST in the crop, not just partially cut.')
      : (reels ? ('REELS useful area, in PERCENT of the canvas (the Instagram UI covers everything outside it): compose the entire piece inside this rectangle — horizontally from ' + areaUtilFallback.x0 + ' to ' + areaUtilFallback.x1 + ', vertically from ' + areaUtilFallback.y0 + ' to ' + areaUtilFallback.y1 + '.')
              : ('FEED/CAROUSEL useful area, in PERCENT of the canvas: compose the entire piece inside this rectangle — horizontally from ' + areaUtilFallback.x0 + ' to ' + areaUtilFallback.x1 + ', vertically from ' + areaUtilFallback.y0 + ' to ' + areaUtilFallback.y1 + '.')),
    '',
    '=== VALIDATION BEFORE RENDERING (run this checklist, fix silently, then render) ===',
    // 23/set/2026: este checklist tinha o MESMO problema que o da seção QUALITY (mais abaixo) já
    // corrigiu — citava o teto de palavras antigo (6/18) e a hierarquia fixa (50-60%) mesmo quando
    // a seção 2 e a seção 5 já declaram outra coisa. Mesma correção, mesmo motivo.
    // 24/set/2026 (decisão 5 desta rodada): acrescentado o teto novo da prova (6 palavras,
    // número + substantivo) — antes este checklist nunca perguntava por ela.
    o.composicaoAtiva
      ? 'Zero text, letters, digits, labels, pills, logos or watermarks anywhere in the image — not even the brand name? Only the palette colors above? Photo with controlled contrast? 3 depth layers present? Negative space respected? Left half left calm and uncluttered for the system to cover? Safe zones clear? If any answer is NO, fix the composition BEFORE rendering.'
      // CTA E SELO POR CÓDIGO (decisão 4): checklist não pergunta mais por CTA nem por label —
      // nenhum dos dois é renderizado pelo modelo neste caminho.
      : ('Headline <=8 words? Support copy <=12 words? ' + (o.ctaSeloPorCodigo ? '' : 'CTA <=2? ') + 'Proof point <=6 words, number+noun shape? Piece text total <=22 (text belonging to a scene object correctly excluded from this count)? Spelling 100% correct in Portuguese? Only the palette colors above? ' + (o.ctaSeloPorCodigo ? '' : 'Label 8-12% width with 7:1 contrast? ') + (hierarquiaVS ? 'Reading priority follows the brand\'s own declared hierarchy?' : 'Headline dominant at 50-60% of attention?') + ' Photo with controlled contrast? 3 depth layers present? Negative space respected? Eye-flow defined? Safe zones clear of important text? If any answer is NO, fix the composition BEFORE rendering.'),
    '',
    '=== 13. PARAMETERS ===',
    // densidade_visual (23/set/2026): substitui o PAR intensidade/complexidade (não só a
    // intensidade) quando a marca declara a própria densidade — ver Alterações da entrega.
    densVisual
      ? ('Visual density (brand-declared): ' + densVisual + '. Emotional temperature: ' + temp + '. Base style: ' + estilo + '.')
      : ('Intensity: ' + intens + ' (' + vazio + ' empty). Complexity: ' + elems + ' elements. Emotional temperature: ' + temp + '. Base style: ' + estilo + '.'),
    '',
    o.composicaoAtiva
      ? '=== SCENE BRIEF (do NOT render any of this as text — it only tells you what photographic scene to build; every piece of text and the logo are composed separately, by code) ==='
      : '=== CONTENT OF THIS PIECE ===',
    // 🔴 O fallback era 'JUMP' — a NOSSA marca renderizada na arte do CLIENTE (o produto é
    // multi-nicho: um consultório, uma padaria ou um escritório receberiam "JUMP" na peça).
    // Agora: pilar (educação/prova/oferta...) → marca do cliente → o modelo deriva do tema.
    // CTA E SELO POR CÓDIGO (decisão 4): com o.ctaSeloPorCodigo, o selo some do CONTEÚDO pedido ao
    // modelo — o próprio texto do selo é decidido em gerar-imagem.js (pilar||label) e desenhado
    // depois, por código, nunca inventado pelo modelo de imagem.
    (o.composicaoAtiva || o.ctaSeloPorCodigo) ? '' : ((o.label || o.pilar || M.marca)
      ? ('LABEL: "' + String(o.label || o.pilar || M.marca).toUpperCase() + '"')
      : 'LABEL: derive a SHORT category word (1-2 words, uppercase) from the theme itself — it must describe the CONTENT (e.g. "MÉTODO", "BASTIDORES", "RESULTADO"). Never write the name of any software, tool or platform that is not this client\'s own brand.'),
    o.composicaoAtiva
      ? ('SUBJECT: "' + (o.headline || o.tema || '') + '" — this is what the piece is about; build the photographic scene in the right half around it. Never write, letter or render this sentence, or any part of it, anywhere in the image.')
      : ('HEADLINE (dominant, max 8 words): "' + (o.headline || o.tema || '') + '"'),
    o.subheadline
      ? (o.composicaoAtiva
          ? ('ANGLE (context only, never rendered): "' + String(o.subheadline).slice(0, 140) + '"')
          : ('SUBHEADLINE (the WHY — render it as a second, smaller text block under the headline; this is the line that makes the piece convert instead of just look good): "' + String(o.subheadline).slice(0, 140) + '"'))
      : '',
    // 24/set/2026 ("Regeneração dirigida...", decisão 5, autorizado pelo João): teto de 6
    // palavras novo — a peça de 24/set errou justamente numa prova longa com acento ("10
    // usuários em validação, maioria no plano Pro" saiu "10 USUARIOS EN-VALIDAÇÃO, MAIORIA NO
    // PLANS PRS"), frase comprida gravada num objeto pequeno é onde o gerador mais erra
    // português. cortarFrase(90) continua sendo só o teto de CARACTERES do texto do prompt (nunca
    // validado em código — ver validarTextoDaPeca, topo do arquivo, que documenta essa decisão
    // explicitamente); o teto de PALAVRAS abaixo é só a instrução ao modelo, mesmo tratamento que
    // esta rodada deu ao mockup (decisão 4) — sem mecanismo de checagem em código, fora do escopo
    // pedido ("engine6(): ... a declaração do ponto de prova ganha o limite de 6 palavras").
    (o.prova && !o.composicaoAtiva) ? ('PROOF POINT, max 6 words, prefer a NUMBER + NOUN shape over a full sentence (e.g. "10 usuários no Pro", not a long sentence with accents — a real figure/fact, render as a small highlighted stat or badge, NOT invented): "' + cortarFrase(o.prova, 90) + '"') : '',
    o.copy ? ('INSTAGRAM CAPTION (context only — do NOT render this on the image): "' + cortarFrase(o.copy, 90) + '"') : '',
    // CTA E SELO POR CÓDIGO (decisão 4): idem — o CTA sai do CONTEÚDO pedido ao modelo. O texto
    // exato (cta_arte, ou "SWIPE →" no carrossel) é composto depois, por código.
    (o.composicaoAtiva || o.ctaSeloPorCodigo) ? '' : ((o.cta_arte || o.cta) ? ('CTA (max 2 words): "' + (o.cta_arte || o.cta) + '"') : (o.total > 1 ? 'CTA (max 2 words): "SWIPE →"' : '')),
    o.composicaoAtiva ? '' : (o.oferta ? ('OFFER BADGE: "' + o.oferta + '"') : ''),
    '',
    // densidade_visual (23/set/2026): estas duas linhas de checklist final também citavam o
    // % de vazio genérico por número — quando a marca declara densVisual, a seção 7 acima nunca
    // emite esse número, então o checklist deixa de perguntar por ele e passa a perguntar pela
    // densidade declarada (senão o checklist citaria um valor que nunca apareceu no prompt).
    // vs_hierarquia_visual (23/set/2026, decisão 9 desta rodada): mesmo problema, mesma correção —
    // "headline dominant 50-60%" ficava fixo mesmo quando a seção 5 já tinha trocado esse
    // percentual pelo declarado pela marca. Word count também segue o novo teto (22, decisão 2).
    o.composicaoAtiva
      ? ('QUALITY: ultra detailed, Instagram production-ready, premium finish, real photographic scene. Validate before rendering: zero text/letters/digits/labels/logos/watermarks anywhere? palette locked? 3 depth layers? negative space ' + (densVisual || vazio) + '? left half calm and uncluttered? safe zones respected?')
      // CTA E SELO POR CÓDIGO (decisão 4): mesmo ajuste do checklist acima — "label 8-12% at 7:1"
      // não faz sentido quando o modelo não desenha nenhum label.
      : ('QUALITY: ultra detailed, Instagram production-ready, premium finish. Validate the checklist before rendering: piece text word count ≤22? proof point ≤6 words, number+noun? palette locked? ' + (o.ctaSeloPorCodigo ? '' : 'label 8-12% at 7:1? ') + (hierarquiaVS ? ('reading priority follows the brand\'s own declared hierarchy') : 'headline dominant 50-60%') + '? 3 depth layers? negative space ' + (densVisual || vazio) + '? safe zones respected? spelling perfect?'),
  ].filter(Boolean).join('\n');
}



// ═══════════════════════════════════════════════════════════════════════════
// A1 — DIRETOR DE ARTE (a etapa que faltava)
// O gpt-image-1 não raciocina: joga-se 13 seções de regras nele e ele perde as
// últimas (grain, movimento, foco). Aqui um modelo de TEXTO lê o Engine 6.0 (lei)
// + o DNA do Negócio e ESCREVE A CENA FINAL — é o que o ChatGPT faz quando o
// cliente cola o Engine na mão. Se falhar, cai no Engine puro (nunca derruba).
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ PADRÃO SEGURO: já descobrimos na prática que um modelo pequeno NÃO deduz a cena —
// ele procura um exemplo para copiar e a arte sai genérica. O fallback era 'claude-haiku-4-5':
// se a env var sumisse (troca de projeto, deploy novo, erro de digitação), a qualidade caía
// em SILÊNCIO, sem erro nenhum. O padrão agora é o modelo que sabemos que funciona.
// CAUSA RAIZ CONFIRMADA (18/set/2026, "qualidade da arte — diagnóstico", rodada 6): a causa real
// dos dois meses de falha não era código — era AGENT_MODEL_DIRETOR configurada na Vercel com um
// espaço à direita. A Anthropic ecoava o nome recebido COM o espaço ("model: claude-sonnet-5 ",
// not_found_error) — o mesmo nome visível funcionava em api/agente-chat.js porque a variável de
// lá, por acaso, não tinha o espaço. trimEnv() é a defesa: espaço invisível de configuração nunca
// mais vira "modelo não encontrado" em silêncio. Autorizado pelo João.
const trimEnv = (v) => String(v || '').trim();
const MODEL_DIRETOR = () => trimEnv(process.env.AGENT_MODEL_DIRETOR) || 'claude-sonnet-5';
// MODELO DE VERIFICAÇÃO DE TEXTO POR VISÃO (22/set/2026, "Engine 6.0 como caminho padrão",
// Rodada 1, item 3, autorizado pelo João) — mesmo padrão de override-com-default de
// MODEL_DIRETOR acima: env var dedicada, cai no mesmo modelo padrão do resto do arquivo se
// ausente/vazia. Modelo separado de MODEL_DIRETOR de propósito — são etapas diferentes (uma
// escreve cena, a outra só lê o que saiu na imagem) e podem precisar de ajuste independente.
const MODEL_VERIFICACAO_TEXTO = () => trimEnv(process.env.AGENT_MODEL_VERIFICACAO_TEXTO) || 'claude-sonnet-5';

// MODELO DE IMAGEM POR CAMINHO (24/set/2026, "Trocar o motor de imagem e reservar as zonas das
// pílulas", decisão 4, autorizado pelo João) — o nome do modelo de cada caminho (edição
// image-to-image e geração text-to-image) sai de constante literal e vira configuração, mesmo
// padrão de MODEL_DIRETOR/MODEL_VERIFICACAO_TEXTO acima (trimEnv + fallback). PADRÃO ATUAL:
// 'gpt-image-1' — a troca para a linha GPT Image 2.5 (nomes confirmados na doc oficial da OpenAI,
// developers.openai.com: 'gpt-image-2.5-sunburst' e 'gpt-image-2.5-flare', ambos servindo os
// mesmos endpoints images/generations e images/edits) fica disponível por env var, NUNCA como
// padrão automático desta rodada — "precisamos poder voltar ao gpt-image-1 numa linha, e não por
// rollback de deploy" (decisão 4). Dois nomes de env var separados (não uma só) porque a ordem
// pede modelos DIFERENTES por caminho (decisão 3): AGENT_MODEL_IMAGEM_EDICAO para o caminho com
// foto/produto real (Sunburst, precisão de edição), AGENT_MODEL_IMAGEM_TEXTO para o caminho
// conceitual sem material real (Flare, geração rápida). Ver relatório desta entrega para os
// valores exatos a configurar na Vercel quando a troca for aprovada.
const MODEL_IMAGEM_EDICAO = () => trimEnv(process.env.AGENT_MODEL_IMAGEM_EDICAO) || 'gpt-image-1';
const MODEL_IMAGEM_TEXTO = () => trimEnv(process.env.AGENT_MODEL_IMAGEM_TEXTO) || 'gpt-image-1';

// CTA E SELO POR CÓDIGO — CHAVE ÚNICA (25/set/2026, "Devolver CTA e selo ao modelo, e declarar a
// área útil de verdade", decisão 1 e 2, autorizado pelo João) — a Rodada anterior (24/set) tirou
// CTA e selo das mãos do modelo porque o gpt-image-1 errava acento e posição; a primeira peça real
// com gpt-image-2 (25/set 12:47) desenhou os dois — e um quadro branco manuscrito e cinco cards de
// texto, tudo com acentuação correta, sozinho — sem nenhum defeito de texto. A causa que justificava
// código deixou de existir; agora o carimbo por código é que produz o defeito (pílula sobreposta à
// cena, nunca integrada). CTA_SELO_POR_CODIGO = false: todo o mecanismo (Engine para de suprimir
// CTA/selo do modelo, zonas reservadas param de ser declaradas, o compositor de pílulas para de
// desenhar) volta ao comportamento anterior à Rodada de 24/set. O CÓDIGO NÃO FOI REMOVIDO — fica
// dormente atrás desta única chave, pronto pra ser religado numa linha (trocar só este valor) se um
// modelo futuro voltar a errar acento ou posição. Nunca decidida por modelo (não é `if (modelo ===
// 'gpt-image-1')`) — é uma escolha de produto, registrada aqui, não uma capacidade do modelo.
const CTA_SELO_POR_CODIGO = false;

// MODO DA PEÇA — decidido no código (determinístico, testável), não pelo modelo.
//   CENA      = o canvas inteiro é UMA FOTOGRAFIA de um lugar real; o texto é objeto físico.
//               (referência do João: parede de concreto + luminária + letras de aço)
//   EDITORIAL = canvas dividido em ZONAS: zona de texto chapada + zona fotográfica full-bleed,
//               fundidas por gradiente. (referências: EA2000, BMSEG, Chaleur)
// LEI COMUM: sempre existe uma camada fotográfica REAL. Texto sobre fundo vazio é falha.
function escolherModo(o, ctx) {
  const m = String(o.modo || '').toLowerCase();
  if (m === 'cena' || m === 'editorial') return m;
  // Produto real precisa de arquitetura de zonas (ficar íntegro e legível) → EDITORIAL.
  let base = ctx.temProduto || o.tipo === 'produto' ? 'editorial' : 'cena';
  // Recriação RADICAL (100%) troca o modo — conceito novo de verdade, não a mesma peça repintada.
  if (Number(ctx.variacao) === 100) base = (base === 'cena') ? 'editorial' : 'cena';
  return base;
}

const BLOCO_CENA = [
  '=== MODE OF THIS PIECE: CENA (cinematic photograph) ===',
  'The ENTIRE canvas is ONE PHOTOGRAPH of a real physical place. Build it in this order and state each step explicitly in the prompt:',
  'S1. THE SET IS DERIVED FROM THE THEME — THIS IS NOT A STYLE, IT IS A DEDUCTION. Read the theme, ask "where does this actually happen, physically, in the real world?", and shoot THERE. The set must be so specific to the theme that it could not be reused for a different post. Describe the surface material, its pores, stains, seams and wear. The set comes BEFORE any layout decision.',
  'S1b. HARD BAN — the default dark room: a raw/dark concrete or industrial wall with a hanging lamp is FORBIDDEN unless the theme is literally about construction, a workshop or a factory. It is the lazy answer and it means you skipped the deduction. If the theme is software, AI, agents, automation, systems or work: the set contains real SCREENS with real interfaces glowing, a conversation thread lit on a monitor, dashboards, cables, terminals, a control room, a desk mid-work — the light of the screens IS the light of the scene. Money theme: a real counter, notes, a card machine. Food: a real kitchen, a bench, ingredients. Deduce it. Never pick from a menu.',
  'S1c. IF A REAL PHOTO IS ATTACHED: the set is built AROUND that photo. The subject is transplanted exactly as lit in the photo, never re-lit or re-shot. The photo does not bend to serve the set — the set bends to serve the photo. Never describe the subject itself: describe only WHERE it sits, the environment light around it, and the world around it.',
  'S2. THE HEADLINE IS A PHYSICAL OBJECT, NOT AN OVERLAY: give it a real material (cast concrete, brushed or galvanised steel letters bolted to the wall, painted stencil, extruded metal, letterpress) mounted INSIDE the set — receiving the same light, casting real directional shadows, carrying the same grain as the wall. Write it explicitly: "the letters are physical objects in the scene, lit by the lamp, casting their own shadows — not a graphic overlay".',
  'S3. PRACTICAL LIGHT IN FRAME: one visible light fixture inside the shot (hanging industrial lamp, neon tube, window shaft, desk lamp). Describe the cone, the hotspot on the surface, and the falloff — 60-75% of the canvas drops to near-black or deep shadow. Flat, even lighting is a FAILURE.',
  'S4. CAMERA: state focal length, camera height, distance and depth of field (e.g. "35mm, camera at chest height, 2m from the wall, f/2.8, foreground softly out of focus").',
  'S5. ACCENT AS LIGHT: the accent colour enters as a PHYSICAL LIGHT SOURCE in the environment (a small neon sign, an exit light, a coloured gel glowing on a far corner of the wall), plus the label and the CTA. Never as a highlighter.',
  'S6. EVERY SINGLE PIECE OF TEXT IS PHYSICAL MATTER — not only the headline. The label, the support copy and the CTA are engraved plaques, lit signage, printed cards, embossed panels or cut vinyl EXISTING IN THE SET, each catching the light and casting its own small shadow. Small painted lettering is where this model hallucinates (it rendered "SAIBA MAIS" as "SMEA MAS"): text made of matter does not hallucinate. They stay small and quiet — the scene carries the weight — but they are objects.',
].join('\n');

// DOUTRINA CURTA PARA MATERIAL REAL PRESERVADO (20/set/2026, "preservação de material real",
// desenho aprovado pelo João com uma alteração — ver histórico completo em APRENDIZADOS.md).
// Substitui BLOCO_CENA (nunca BLOCO_EDITORIAL, que fica de fora desta correção — investigação
// própria, ainda sem decisão, registrada separadamente) sempre que há pessoa OU produto real
// preservado (ctx.temFoto || ctx.temProduto) E o modo escolhido é 'cena'. Motivo da existência:
// BLOCO_CENA manda "deduzir um lugar físico novo a partir do tema e construir tudo" (S1-S6, ~400
// palavras) — essa ordem competia com o contrato de preservação (S1c, a única linha que
// mencionava foto anexada, enterrada no meio de S1/S1b) e causava a distorção de rosto relatada
// mesmo com o contrato ativo. Aqui a lógica se INVERTE: a doutrina PARTE do material preservado
// como fato consumado, nunca deduz um lugar concorrente. ALTERAÇÃO PEDIDA PELO JOÃO no desenho
// original: a instrução de tratar TODO texto renderizado como matéria física do ambiente (placas
// gravadas, letreiros, vinil — o R5 original, mesma lógica de S2/S6 do BLOCO_CENA) foi REMOVIDA e
// substituída pelo oposto — texto sempre CHAPADO, sem perspectiva/relevo. Motivo apontado por ele,
// com evidência de teste real: texto como objeto tridimensional ganha perspectiva e relevo, e é
// onde as letras mais derretem — a headline chapada da peça de 19/set saiu perfeita; a
// subheadline dentro de um "balão" com volume derreteu com só 4 palavras.
const BLOCO_CENA_MATERIAL_REAL = [
  '=== MODE OF THIS PIECE: CENA — REAL MATERIAL PRESERVED (extend the photograph, do not rebuild it) ===',
  'A real photo is attached and is preserved elsewhere in this prompt (see the preservation contract) — you are not deducing a brand-new physical place from the theme and fitting the subject into it afterwards. You are extending the world the attached photo already exists in.',
  'R1. GROUND THE ENVIRONMENT IN THE PHOTO, NOT IN THE THEME: describe only the surface, space and objects immediately around the preserved subject — real materials, real texture, real depth — growing out of what the photo already shows, never a separately-deduced set that competes with it.',
  'R2. PRACTICAL LIGHT IN FRAME: one visible light source (window, lamp, screen glow, neon, golden hour) — describe the cone, the hotspot and the falloff. Flat, even lighting is a FAILURE.',
  'R3. CAMERA: state focal length, camera height, distance and depth of field.',
  'R4. ACCENT AS LIGHT: the accent colour enters as a physical light source in the environment, plus the label and CTA.',
  'R5. ALL RENDERED TEXT IS FLAT, NOT PHYSICAL: the label, headline, subheadline and CTA are applied FLAT over the image — no perspective, no relief, no physical integration into the scene (no engraved plaques, no lit signage, no cut vinyl here). Text rendered as a 3D object with volume is exactly where letters melt; keep every text element flat and legible.',
  'You are FORBIDDEN from describing, redesigning or reinterpreting the preserved subject itself in any of the above — that is governed entirely by the preservation contract and the SPECIFICS section elsewhere in this prompt.',
].join('\n');

const BLOCO_EDITORIAL = [
  '=== MODE OF THIS PIECE: EDITORIAL (flat, agency-grade) ===',
  'The canvas is split into ZONES. Build it in this order and state each step explicitly in the prompt:',
  'E1. ZONE SPLIT: divide the canvas into a TEXT ZONE (solid colour or subtle gradient from the palette, ~45-55%) and a PHOTOGRAPHIC ZONE (~45-55%). Typically: photograph on the right / upper-right BLEEDING OFF the canvas edge, text block on the left. State the boundary and state that the photo runs off the edge — never a floating rectangle, never a framed thumbnail, never a rounded card.',
  'E2. THE FUSION: the two zones are welded by a soft gradient and shadow — the photograph dissolves into the solid colour and the solid colour is tinted by the light of the photograph. State this explicitly. A hard rectangular seam between photo and colour is a FAILURE.',
  'E3. THE PHOTOGRAPH IS REAL, SPECIFIC AND DEDUCED FROM THE THEME: ask "where does this actually happen in the real world?" and shoot THERE — a real product / real object / real scene, directional light, real shadows, shallow depth of field (angle, lighting direction, material, focus). It must be so specific to the theme it could not be reused for another post. If the theme is software/AI/automation: real screens with real interfaces, a conversation thread on a monitor, a dashboard mid-work. Never a vector illustration or an icon standing in for a photograph. If a photo is ATTACHED, it IS this zone — build around it, never describe the subject itself.',
  'E4. FLAT COMPONENTS HAVE REAL STRUCTURE: the label is a SOLID FILLED PILL (not a hollow outline box). Under the headline, one short thin accent rule (2-3px, ~10% of canvas width). Info boxes, when present: 1px accent stroke, generous inner padding, an icon on the left, a bold accent title plus light body text inside. The CTA is a SOLID FILLED PILL or a bold arrow group. Everything aligns to ONE left margin.',
  'E5. ONE THEMATIC GRAPHIC BRIDGES THE ZONES: a single element in the accent colour that starts in the flat zone and physically touches the photograph (concentric arcs leaving a sound source, a line chart falling across the objects, a thin arrow entering the photo). This is what makes flat design look designed instead of assembled. Choose it from the THEME, never generic.',
  'E6. LIGHT: the photographic zone carries real directional light and deep shadow; the flat zone stays quiet. Never both busy.',
].join('\n');

// BLOCO_EDITORIAL_MATERIAL_REAL (21/set/2026, "supressão no modo editorial — material real em
// qualquer modo"): simétrico ao BLOCO_CENA_MATERIAL_REAL, para o ramo editorial. Pedido do João
// após ele mesmo apontar, pela leitura item a item de BLOCO_EDITORIAL, que E1 (sangramento corta
// o material), E2 (dissolve/tinge a foto), E3 (deduz/cria uma fotografia nova — a mesma posição
// enterrada do bug original de BLOCO_CENA) e E6 (reilumina a zona fotográfica) atacam exatamente
// o que o contrato de preservação existe para proteger. E4 é seguro e entra íntegro (só
// renumerado E4→M3). E3 sai inteiro — nenhuma fotografia é deduzida ou criada: o material
// anexado JÁ É a zona fotográfica. M1/M5 (sem corte, sem reiluminar) só passaram a ser
// cumpríveis depois da reescrita do CONTRATO DE PRESERVAÇÃO logo abaixo (LIBERADOS não inclui
// mais crop do sujeito nem luz sobre o sujeito) — antes dessa reescrita essas duas promessas
// seriam descartadas pelo próprio contrato, que se declara vencedor de qualquer conflito.
const BLOCO_EDITORIAL_MATERIAL_REAL = [
  '=== MODE OF THIS PIECE: EDITORIAL — REAL MATERIAL PRESERVED (the material is the photographic zone, never created) ===',
  'A real photo is attached and is preserved elsewhere in this prompt (see the preservation contract) — you are not deducing or shooting a new photograph for this piece. The attached material IS the photographic zone in full.',
  'M1. ZONE SPLIT: divide the canvas into a TEXT ZONE (solid colour or subtle gradient from the palette, ~45-55%) and a PHOTOGRAPHIC ZONE (~45-55%) that shows the preserved material WHOLE — no bleed off the canvas edge, no crop that cuts the product or the person. State the boundary; the material sits fully inside its zone, uncropped.',
  'M2. THE FUSION HAPPENS ON THE FLAT SIDE: the solid-colour zone is what carries the gradient and the shadow that approaches the photographic zone — the preserved material itself is never dissolved, tinted or blended into the colour. Describe the gradient reaching toward the photo, never touching or altering it.',
  'M3. FLAT COMPONENTS HAVE REAL STRUCTURE: the label is a SOLID FILLED PILL (not a hollow outline box). Under the headline, one short thin accent rule (2-3px, ~10% of canvas width). Info boxes, when present: 1px accent stroke, generous inner padding, an icon on the left, a bold accent title plus light body text inside. The CTA is a SOLID FILLED PILL or a bold arrow group. Everything aligns to ONE left margin.',
  'M4. THE THEMATIC GRAPHIC STAYS IN THE FLAT ZONE: a single element in the accent colour may exist in the flat zone and reach up to its border — it is FORBIDDEN from crossing, overlapping or touching the preserved material in any way. No line, arc, arrow or shape may enter the photographic zone.',
  'M5. LIGHT IS WHATEVER THE PHOTO ALREADY HAS: no directional relighting, no added shadow, no colour grade applied to the preserved material. The flat zone may carry its own light and shadow — the photographic zone does not.',
  'You are FORBIDDEN from describing, redesigning or reinterpreting the preserved subject itself in any of the above — that is governed entirely by the preservation contract and the SPECIFICS section elsewhere in this prompt.',
].join('\n');

// BLOCO_EDITORIAL_COMPOSICAO / _MATERIAL_REAL (22/set/2026, "composição — Fase 1", autorizado
// pelo João): usados só quando o interruptor da conta está ligado E o modo resolvido é
// EDITORIAL (única arquitetura que esta fase compõe — CENA fica para a Fase 2, ver
// _composicao-lib.js). Diferem de BLOCO_EDITORIAL/BLOCO_EDITORIAL_MATERIAL_REAL porque o
// código, não o modelo, desenha toda a zona chapada (fundo, gradiente de fusão, selo,
// headline, fio, subheadline, prova, CTA) e o logo — então E1(divisão)/E2(fusão)/E4 ou
// M3(pílulas) deixam de ser instrução PARA O MODELO: ele só precisa gerar uma foto real na
// metade direita e manter a metade esquerda calma (será inteiramente coberta). O 45-55%
// virou 50% fixo porque é o que os templates de _composicao-lib.js realmente usam
// (zonaTexto/zonaFoto, ambos w:0.5) — não é mais uma faixa que o modelo escolhe.
const BLOCO_EDITORIAL_COMPOSICAO = [
  '=== MODE OF THIS PIECE: EDITORIAL — SERVER COMPOSITION ACTIVE (the system draws all text and the logo; you draw only the scene) ===',
  'C1. ZONE SPLIT: the canvas is split into a LEFT zone (50%, will be entirely covered by the system with the brand text) and a RIGHT photographic zone (50%) that bleeds off the canvas edge. Build a real, specific photograph in the right zone — the left zone just needs to stay calm and simple (it will be painted over, so any detail there is wasted, not forbidden).',
  'C2. THE PHOTOGRAPH IS REAL, SPECIFIC AND DEDUCED FROM THE THEME: ask "where does this actually happen in the real world?" and shoot THERE — a real product / real object / real scene, directional light, real shadows, shallow depth of field. It must be so specific to the theme it could not be reused for another post. If the theme is software/AI/automation: real screens with real interfaces, a conversation thread on a monitor, a dashboard mid-work. Never a vector illustration or an icon standing in for a photograph.',
  'C3. LIGHT: the photographic (right) zone carries real directional light and deep shadow; the left zone stays visually quiet.',
  'C4. ABSOLUTE BAN: do not render, draw, write, letter, stencil, engrave or in any way create ANY text, number, digit, letter, glyph, label, pill, button, badge, logo, symbol, emblem, monogram or watermark ANYWHERE in the image — not even the brand name. The entire piece is photography/scene only; every piece of text and the logo are composed by code after you finish.',
].join('\n');

const BLOCO_EDITORIAL_COMPOSICAO_MATERIAL_REAL = [
  '=== MODE OF THIS PIECE: EDITORIAL — SERVER COMPOSITION ACTIVE + REAL MATERIAL PRESERVED (the material is the photographic zone; the system draws all text and the logo) ===',
  'A real photo is attached and is preserved elsewhere in this prompt (see the preservation contract) — you are not deducing or shooting a new photograph. The attached material IS the right-hand photographic zone in full.',
  'D1. ZONE SPLIT: the canvas is split into a LEFT zone (50%, will be entirely covered by the system with the brand text — stays calm and simple) and a RIGHT photographic zone (50%) that shows the preserved material WHOLE — no bleed off the canvas edge, no crop that cuts the product or the person.',
  'D2. LIGHT IS WHATEVER THE PHOTO ALREADY HAS: no directional relighting, no added shadow, no colour grade applied to the preserved material. The left zone may carry its own light — the photographic zone does not.',
  'D3. ABSOLUTE BAN: do not render, draw, write, letter, stencil, engrave or in any way create ANY text, number, digit, letter, glyph, label, pill, button, badge, logo, symbol, emblem, monogram or watermark ANYWHERE in the image — not even the brand name. Every piece of text and the logo are composed by code after you finish.',
  'You are FORBIDDEN from describing, redesigning or reinterpreting the preserved subject itself in any of the above — that is governed entirely by the preservation contract and the SPECIFICS section elsewhere in this prompt.',
].join('\n');

async function diretorDeArte(M, o, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const engine = engine6(M, o);
  const modo = escolherModo(o, ctx);
  // MATERIAL REAL PRESERVADO (20/set/2026): condicionado à EXISTÊNCIA do material (temFoto ou
  // temProduto), nunca ao modo escolhido — pedido explícito do João, com prova própria: a
  // recriação radical (variacao===100, ver escolherModo acima) INVERTE cena↔editorial, então um
  // produto real pode cair em modo 'cena' mesmo sendo produto (o caminho que hoje só evita
  // BLOCO_CENA por CONSEQUÊNCIA do roteamento de escolherModo, não por regra própria). Checar
  // temFoto||temProduto direto, e não confiar no modo para proteger, é o que cobre esse caso.
  // EDITORIAL agora também condicionado (21/set/2026): o ramo editorial IGNORAVA a variável —
  // produto real cai em editorial por padrão (escolherModo, acima), então o caminho mais comum
  // pra produto era justamente o desprotegido; e uma foto pessoal encaminhada ao editorial
  // também ficava sem proteção. BLOCO_EDITORIAL_MATERIAL_REAL fecha essa lacuna.
  const materialRealPreservado = !!(ctx.temFoto || ctx.temProduto);
  const sys = [
    'You are an award-winning art director for premium Brazilian Instagram brands.',
    'You receive a DESIGN SYSTEM (it is LAW — never violate, never omit) and a content brief.',
    'Your job: write ONE final, dense, concrete image-generation prompt in English for an image model that does NOT reason. It renders literally what you describe — so describe matter, not intentions.',
    '',
    '=== LAW 0 — THERE IS ALWAYS A REAL PHOTOGRAPHIC LAYER (absolute) ===',
    'Every reference-grade piece is built on real photographic matter. Text floating on an empty coloured background, decorated with a few outlined shapes, is an AMATEUR FAILURE and is forbidden. Whatever the mode: real surfaces, real objects, real light, real depth, real grain.',
    '',
    modo === 'cena'
      ? (materialRealPreservado ? BLOCO_CENA_MATERIAL_REAL : BLOCO_CENA)
      : (o.composicaoAtiva
          ? (materialRealPreservado ? BLOCO_EDITORIAL_COMPOSICAO_MATERIAL_REAL : BLOCO_EDITORIAL_COMPOSICAO)
          : (materialRealPreservado ? BLOCO_EDITORIAL_MATERIAL_REAL : BLOCO_EDITORIAL)),
    '',
    '=== HOW TO WRITE IT (both modes) ===',
    '1. Total concreteness. Describe the finished piece as it physically is: where each element sits (upper-left, lower third), sizes as % of canvas, colours by HEX, direction of light, material, texture, depth. Never restate a rule as a rule ("the headline must dominate" WRONG -> "the headline sits upper-left, cap-height ~11% of canvas height, three short lines, the brightest object in the frame" RIGHT).',
    '2. DOMINANCE IS WON BY LIGHT AND CONTRAST — NEVER BY SIZE. The headline is the brightest, highest-contrast thing in the frame while everything else sits in shadow or low contrast. It occupies AT MOST 30% of the canvas area (cap-height 8-14% of canvas height). A headline that fills half the canvas is a slide deck, not a campaign: FAILURE.',
    // ETAPA 2 (16/set/2026, "Engine — Etapas 1 e 2"): removido o item que antes era "3. LENGTH IS
    // YOUR RESPONSIBILITY... REWRITE it..." — pedia para VOCÊ (o Diretor) reescrever a headline se
    // ela excedesse 8 palavras. O código agora garante o limite ANTES de chegar aqui
    // (validarTextoDaPeca, no topo deste arquivo): se o texto chegou até esta função, já passou
    // pela validação — está dentro do limite, por construção. Reescrever aqui seria uma SEGUNDA
    // decisão de texto por cima da primeira, a mesma falha que a unificação das arquiteturas
    // corrigiu para o Criativo. Você recebe a lista de texto fechada — não é permitido alterar
    // nenhum caractere dela. Decide-se ONDE o texto fica, com que peso, em que material, sob que
    // luz — nunca O QUE ele diz.
    '3. TYPOGRAPHY: never name a font. Describe weight, width, stroke contrast, terminals, corner treatment, tracking, case, line-height. Mixing weight or colour inside the headline is allowed ONLY per whole line (line 1 neutral, line 2 accent) — never per random word.',
    '4. ACCENT DISCIPLINE: the accent colour appears in exactly 3-4 places and they are STRUCTURAL (label pill, thin rule, CTA pill, the thematic graphic, icon strokes) or, in CENA mode, physical light. STRICTLY FORBIDDEN: underlining words, highlighting or colouring isolated words inside the headline. That is a marker pen, not art direction.',
    '5. NEGATIVE SPACE IS ATMOSPHERE, NOT BLANK. The empty percentage the design system asks for means "no elements there" — that area must still be full of matter: textured surface, light falloff, gradient, grain, dust in the light beam. A flat empty area is a FAILURE.',
    '6. HUMAN MODE: visible film grain 3-5% across the ENTIRE frame, micro-wear, real optics and real shadows. Goal: a photograph of a real campaign, not an AI render.',
    '7. ALWAYS bake in explicitly: the depth layers, the safe zones, the label prominence, the eye-flow. These are exactly the rules weak prompts drop.',
    o.composicaoAtiva
      ? 'THERE IS NO TEXT TO RENDER IN THIS PIECE. Any headline/subheadline/proof/CTA mentioned below is SCENE CONTEXT ONLY — what the post is about, so you can build a relevant photograph — never a string to letter, stencil or write anywhere in the image.'
      : 'THE TEXT LIST IS CLOSED AND YOU MAY NOT CHANGE ONE CHARACTER OF IT. The headline, subheadline, proof point and CTA below already passed a word-count gate in code (Etapa 1: headline ≤8 words, subheadline ≤6, CTA ≤2) — if it reached you, it is valid text, decided by someone else. Your only authority is placement, weight, material and light. If a string looks wrong to you, render it exactly as given anyway — you are not the editor of it.',
    '',
    '=== SPECIFICS ===',
    // MATERIAL REAL MANDA NA POSE (24/set/2026, "Foto travada de verdade, CTA e selo por código,
    // e enxergar o Diretor", decisão 2, autorizado pelo João) — CAUSA RAIZ do rosto distorcido: a
    // trava de DESCRIÇÃO (proibir citar rosto/barba/tatuagem) já funcionava, mas este texto ainda
    // pedia POSTURA ("which side they sit on") e EXPRESSÃO ("gaze direction pointing toward the
    // headline") — nenhum dos dois é descrição do rosto, mas os dois são do SUJEITO, não do
    // ambiente. Para caber numa postura/olhar que o Diretor inventa, o gerador REDESENHA o corpo
    // — é como uma foto de pessoa EM PÉ, com microfone, gesticulando, virou "seated... gaze
    // directed toward the upper-left quadrant" na peça real de 24/set 20:32 (evidência via SQL).
    // Correção: postura, enquadramento do CORPO, ângulo e expressão saem do que o Diretor pode
    // dirigir — ele descreve só ONDE NO QUADRO o sujeito aparece (não como ele está posicionado),
    // nunca um verbo que impõe postura ("sits", "leans", "rests", "stands").
    ctx.temFoto ? 'A REAL PHOTO of the client is attached. It is FIXED — the person is transplanted into the scene exactly as they already are in the photo: same pose, same body position, same gesture, same expression, never re-photographed, never re-lit, never repositioned. Their posture, body position, gesture and gaze are NOT yours to direct — they come from the photo exactly as it already is. Describe ONLY: which side of the FRAME they appear on, the crop that keeps them entirely in frame, the environment\'s light around them, the contact shadow they cast into the set. NEVER use a verb that imposes posture ("sits", "leans", "rests", "stands", "poses") — you are describing where in the frame they are, never how their body is arranged. YOU ARE FORBIDDEN from describing the person AT ALL — no face, no hair, no beard, no tattoos, no jewellery, no build, no age, no clothing detail, no pose, no gesture, no gaze direction, not one adjective about them. Every word you write about the subject is a word the generator will use to REDRAW them. Describe the world around them; the photo defines the person, exactly as they already are in it.' : 'No real photo of a person is attached: never invent a generic AI person. Build the piece from the set, objects, materials and light.',
    ctx.temProduto ? 'A REAL PRODUCT photo is attached. It is FIXED and it is a real product a real customer will receive — altering it makes this false advertising. It is the hero of the photographic zone, exactly as lit in the photo, never re-lit. Describe ONLY where it sits, the crop that keeps it entirely in frame, the surface under it, the environment\'s light around it and its contact shadow. YOU ARE FORBIDDEN from describing the product itself — not its shape, colour, label, filling, topping or finish. Every adjective you write about it is permission for the generator to redesign it.' : '',
    'Never include any logo, symbol, emblem, monogram, watermark or invented brand mark. The brand mark is applied later by the system.',
    // GOSTO DO CLIENTE (16/set/2026, "unificação das arquiteturas de prompt"): antes esta
    // memória só existia como INSTRUÇÃO na persona do Criativo — que compunha o prompt de
    // imagem ela mesma, então "respeite o gosto do cliente" tinha efeito. Com o Criativo só
    // decidindo conteúdo (não mais escrevendo prompt visual), aquela instrução virou letra
    // morta: preservada no texto, sem efeito nenhum — falha silenciosa. M já carrega
    // referencia_aprovada/evitar_visual (mems globais, buscadas acima) — só faltava
    // repassar. Como FATO aprendido, não como comportamento pedido: o Diretor recebe o que
    // já funcionou e o que já foi rejeitado e compõe a partir disso, mesmo padrão dos blocos
    // de dado real (ex.: "SEU PLANO") em vez de pedir ao modelo para "se lembrar" de agir bem.
    (M.referencia_aprovada || M.evitar_visual) ? (
      'CLIENT VISUAL TASTE ON RECORD (fact, learned from pieces this client already reacted to — use it, do not restate it as a rule to follow):'
      + (M.referencia_aprovada ? ' Approved before, repeat what worked: "' + String(M.referencia_aprovada).slice(0, 200) + '".' : '')
      + (M.evitar_visual ? ' Rejected before, never repeat it: "' + String(M.evitar_visual).slice(0, 200) + '".' : '')
    ) : '',
    // CENA COM MEMÓRIA (24/set/2026, "Regeneração dirigida, defeito visível e cena que não se
    // repete", decisão 3, autorizado pelo João) — causa apontada da monotonia visual (luminária/
    // notebook/caneca/texto-na-parede em praticamente toda peça): cada geração nasce sem nenhuma
    // memória do que já foi feito pra este cliente. ctx.cenasRecentes vem pronto de fora (ver
    // ponto de montagem no handler, mesmo padrão de M6/_dnaFaltando — nunca recalculado aqui).
    // INVARIANTE (explícito no pedido do João): isto é CONTEXTO NEGATIVO — "não repita" — nunca
    // uma fonte do que construir; por isso o bloco só lista o que EVITAR, nunca sugere um tema ou
    // objeto novo. Nas primeiras peças de um cliente não há histórico (array vazio) — o Diretor
    // segue exatamente como já se comportava, sem este bloco; o efeito só aparece a partir da 3ª
    // peça registrada com resumo (ver montagem do resumo mais abaixo, "SCENE MEMORY").
    (ctx.cenasRecentes && ctx.cenasRecentes.length) ? (
      'RECENT SCENES FOR THIS SAME CLIENT — NEGATIVE CONTEXT ONLY (what to AVOID, never what to build): the last '
      + ctx.cenasRecentes.length + ' piece(s) made for this client already used these scenes — do NOT reuse the same environment, the same main objects or the same framing as any of them. Deduce a genuinely different one from THIS piece\'s own theme, exactly as you always do — this list only narrows what you may not repeat, it never suggests a replacement:\n'
      + ctx.cenasRecentes.map((s, i) => (i + 1) + '. ' + s).join('\n')
    ) : '',
    o.composicaoAtiva ? '' : 'TEXT HIERARCHY — USE THE FULL TEXT BLOCK — A LONE HEADLINE LOOKS POOR AND DOES NOT SELL. The brief gives you a hierarchy: HEADLINE (the hook), SUBHEADLINE (the why — a second, smaller line that creates desire or tension), PROOF POINT (a real stat/fact), and CTA. Compose ALL of them into the piece as a clear typographic hierarchy — big headline, smaller subheadline beneath it, the proof as a small highlighted stat/badge, the CTA as a button/plaque. If a subheadline or proof is provided, rendering only the headline is a FAILURE. This text hierarchy is what fills the composition — never pad an empty layout with invented scenery when you were given real words to place.',
    // ETAPA 2 (16/set/2026): esta linha antes disparava sempre que o headline chegasse vazio —
    // "NO HEADLINE WAS PROVIDED: write the headline yourself". Depois da Etapa 1 (validação em
    // código, ver validarTextoDaPeca no topo do arquivo), headline vazia é RECUSADA antes de
    // chegar aqui — se chegou até este ponto vazia, é porque a chamadora pediu explicitamente a
    // exceção nomeada (ctx.permitirInvencaoHeadline), os dois ramos de fallback do laço de ordens
    // em agentes.html ('criar_avulso' sem itens e o catch-all genérico), já registrados com
    // comentário explícito nesse arquivo. Fora dessa exceção, headline vazia nunca chega aqui —
    // a invenção deixa de ser comportamento geral e vira exclusiva desse caminho, condicionada.
    (!o.headline && ctx.permitirInvencaoHeadline) ? 'NO HEADLINE WAS PROVIDED (named exception — an internal order-queue fallback path with no upstream agent deciding text yet, logged as a deliberate exception, never the default behaviour): write the headline yourself from the theme — maximum 8 words, punchy, in Portuguese. Never dump the whole briefing as the headline.' : '',
    ctx.variacao ? ('CONTROLLED REVISION OF THE SAME ARTWORK (not a new piece). Freedom level: ' + ctx.variacao + '%.\n'
      + ({10:'10% = pointwise: keep composition, copy, style, palette and layout practically identical — touch ONLY what the client asked.',
          30:'30% = light: keep the structure, style and copy; adjust the requested element and what is strictly needed around it.',
          50:'50% = medium: you may rework the copy wording and some visual elements, but the style, brand identity and main structure of the image MUST remain.',
          100:'100% = full: you may recompose image, copy, layout and elements — but you MUST still obey the client request and every rule of the brand DNA.'}[Number(ctx.variacao)] || 'Change only what is needed for the request.')
      + '\n⛔ BRAND DNA IS INVIOLABLE AT ANY LEVEL: the percentage says HOW MUCH may change, never permission to leave the brand. Palette, typography system, tone, visual identity and every rule above apply 100% at 10%, 50% and 100%. Never invent colors or styles outside the DNA.\n'
      // VARIAÇÃO NÃO TOCA NO SUJEITO (24/set/2026, decisão 3 da mesma ordem, autorizado pelo
      // João) — AGRAVANTE do achado 1: os hints de 50%/100% abaixo eram INCONDICIONAIS — "different
      // placement and photographic treatment" (50%) e "new light" (100%) valiam mesmo com material
      // real preservado, contradizendo o contrato de preservação DENTRO DO MESMO PROMPT (a variação
      // 50 do botão "Recriar imagem" autorizava exatamente o que o Achado 1 já proibia). Com
      // materialRealPreservado, os hints trocam de alvo: a liberdade se aplica ao SET/ambiente/
      // metáfora/história ao redor do sujeito, nunca ao posicionamento ou tratamento fotográfico DO
      // sujeito — em nenhum nível, nem 100%.
      + (materialRealPreservado ? '\n⛔ MATERIAL REAL PRESERVADO AT ANY VARIATION LEVEL: even at 50% or 100%, the preserved subject\'s placement, pose, body framing and photographic treatment NEVER change — the percentage governs the set, story, objects, metaphor and environment light around them, never the subject itself. This applies even when the hint below says "recompose" or "start over": recompose the WORLD around the subject, never the subject.\n' : '')
      + 'Legacy hint: ' + (materialRealPreservado
        ? ({
            25: 'keep the concept and layout; change the light, textures, secondary elements, crop and colour accents IN THE ENVIRONMENT ONLY — the preserved subject\'s placement and photographic treatment never change. Same idea, fresh execution.',
            50: 'keep the brand system and the headline, but rebuild the composition: different structure, different visual metaphor, different set, objects and environment light — the preserved subject\'s placement and photographic treatment are NOT part of what changes here; they stay exactly as the preservation contract requires.',
            100: 'start over on the SET: new environment, new concept, new metaphor, new composition, new light around the preserved subject. Only the palette, the typography rules and the text stay — and the preserved subject itself: its placement and photographic treatment never change, at any variation level, whenever real material is preserved. It must not resemble the previous version in set, concept or metaphor.',
          }[ctx.variacao] || 'change the composition meaningfully in the environment around the preserved subject — never the subject\'s placement or photographic treatment.')
        : ({
            25: 'keep the concept and layout; change the light, textures, secondary elements, crop and colour accents. Same idea, fresh execution.',
            50: 'keep the brand system and the headline, but rebuild the composition: different structure, different visual metaphor, different placement and photographic treatment.',
            100: 'start over. New set, new concept, new metaphor, new composition, new light. Only the palette, the typography rules and the text stay. It must not resemble the previous version.',
          }[ctx.variacao] || 'change the composition meaningfully.'))) : '',
    ctx.ajuste ? ('CLIENT EDIT REQUEST (this is an INSTRUCTION TO YOU, never text to render): "' + String(ctx.ajuste).slice(0, 300) + '".\n'
      + 'CRITICAL: this sentence is a DIRECTION for how to change the artwork — it must NEVER become the headline, subheadline, label, CTA or any text drawn on the image. The rendered text stays EXACTLY as specified in the content block below.\n'
      + 'Classify it and change ONLY that dimension: background/scene · composition · position of subject · photo or element swap · color · typography treatment · layout. Everything else (identity, palette, strategy, hierarchy, safe zones, crop rules, typography system, the rendered copy) stays IDENTICAL to the original piece. This is a controlled revision of the SAME artwork, not a new one.') : '',
    '',
    o.composicaoAtiva ? '' : '=== TEXT TO RENDER (accent bug — the model invents accents) ===',
    o.composicaoAtiva ? '' : 'End the prompt with a list titled "Text to render:", ONE line per text string that appears in the art (headline lines, subheadline, proof, CTA, label), each between double quotes, in Brazilian Portuguese, EXACTLY as it must appear. This list is the single source of truth for every glyph — the model must copy from it, not re-spell.',
    o.composicaoAtiva ? '' : 'Check every line before writing it: (a) NUMBERS are digits, never letters — "8 agentes" never "B agentes"; (b) accents correct — automatizando (not "sutamatizando"), você, só, não, já, negócios; (c) no invented, doubled or dropped letters. Spell each word letter by letter in your head.',
    o.composicaoAtiva
      ? 'Then append this sentence verbatim: "Do not render, draw or write any text, number, letter, digit, label, logo or watermark anywhere in this image. The piece is photography/scene only."'
      : 'Then append this sentence verbatim: "Render every line character-for-character exactly as written in the Text-to-render list. Do NOT re-spell, translate, add, remove, double or invent any letter, digit or accent mark. Numbers stay as digits. Words without an accent stay without an accent. Do not add any other text anywhere in the image."',
    '',
    o.composicaoAtiva
      ? 'OUTPUT: only the final prompt. No preamble, no bullet points, no explanations, no markdown. Write it AS LONG AS THE PIECE NEEDS — typically 400-700 words — one dense concrete paragraph describing the photographic scene, ending with the no-text sentence above. Do NOT compress: completeness and concreteness beat brevity. Bake in every rule (depth layers, safe zones, the deduced set, the light, the camera).'
      : 'OUTPUT: only the final prompt. No preamble, no bullet points, no explanations, no markdown. Write it AS LONG AS THE PIECE NEEDS — typically 600-1000 words — one dense concrete paragraph, then the "Text to render:" list. Do NOT compress: completeness and concreteness beat brevity. Bake in every rule (depth layers, safe zones, label prominence, eye-flow, the deduced set, the light, the camera).',
    '',
    // SCENE MEMORY (24/set/2026, decisão 3 acima): esta linha final é bookkeeping interno, nunca
    // parte do prompt de imagem — é o que alimenta ctx.cenasRecentes da PRÓXIMA peça deste mesmo
    // cliente (ver extração logo abaixo do retorno desta função, e a gravação no handler). Pedida
    // como a ÚLTIMA linha do texto, num formato fixo e reconhecível, pra poder ser separada do
    // resto do prompt por código de forma determinística (nunca por interpretação de IA de novo).
    '=== SCENE MEMORY (internal bookkeeping, NEVER part of the image prompt) ===',
    'After writing the entire prompt above, add exactly ONE more line, on its own, as the very last line of your output, starting exactly with "SCENE_SUMMARY:" followed by a short one-line description IN PORTUGUESE of the environment and the main objects you chose for THIS scene (e.g. "SCENE_SUMMARY: cozinha industrial, bancada de aço escovado, luminária pendente, xícara de café fumegante"). This line is internal bookkeeping only — it is stripped out before the prompt reaches the image generator, must never be rendered, drawn, mentioned or treated as scene content itself, and must always come after everything else, never in the middle.',
  ].filter(Boolean).join('\n');

  const user = 'DESIGN SYSTEM (LAW):\n' + engine + '\n\nWrite the final image prompt now.';
  try {
    // CAUSA REAL CONFIRMADA (17-18/set/2026, "qualidade da arte — diagnóstico", rodada 4): o
    // literal de MODEL_DIRETOR() já é válido — o MESMO texto funciona ao vivo em
    // api/agente-chat.js. A diferença real é que aquele arquivo manda
    // output_config:{effort:'low'} quando usa um modelo forte (comentário de lá: "modelos novos
    // — Sonnet 5/Opus — vêm com raciocínio 'high' por padrão"); esta chamada nunca mandou esse
    // parâmetro. Corrigido: manda output_config primeiro; se a Anthropic recusar, repete SEM ele
    // antes de desistir — a mesma defesa de duas tentativas que agente-chat.js já tem (linhas
    // 1539-1557), pra uma rejeição de parâmetro não derrubar o Diretor inteiro sem 2ª chance.
    let r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 3000, system: sys, messages: [{ role: 'user', content: user }], output_config: { effort: 'low' } }),
    });
    let tentativa = 'direto (com output_config)';
    if (!r.ok) {
      const corpoErro1 = await r.text();
      console.error('diretor: 1ª tentativa (com output_config) recusada, repetindo sem ele —', corpoErro1.slice(0, 160));
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 3000, system: sys, messages: [{ role: 'user', content: user }] }),
      });
      tentativa = 'repetição (sem output_config)';
    }
    // NADA FALHA EM SILÊNCIO (17/set/2026, "qualidade da arte — diagnóstico"): antes só o texto
    // cru da resposta (truncado em 160 chars) ia pro log — se a mensagem de erro fosse longa,
    // `error.type` (a classificação real: not_found_error, permission_error, invalid_request_error...)
    // podia ficar de fora do corte. Agora tenta o JSON primeiro e loga tipo+mensagem sem ambiguidade;
    // só cai pro texto cru se o corpo não for JSON válido.
    if (!r.ok) {
      const corpoErro = await r.text();
      try {
        const j = JSON.parse(corpoErro);
        console.error('diretor: falhou nas duas tentativas —', MODEL_DIRETOR(), (j.error && j.error.type) || '(sem type)', '—', (j.error && j.error.message) || '(sem message)');
      } catch (e2) { console.error('diretor: falhou nas duas tentativas —', MODEL_DIRETOR(), 'corpo não-JSON:', corpoErro.slice(0, 160)); }
      return null;
    }
    if (tentativa === 'repetição (sem output_config)') console.error('diretor: funcionou na repetição, sem output_config —', MODEL_DIRETOR());
    const d = await r.json();
    const t = (d.content || []).map(c => c.text || '').join('').trim();
    if (t.length <= 120) return null; // resposta curta demais = não confiável
    // SCENE MEMORY (24/set/2026, decisão 3): separa a última linha "SCENE_SUMMARY: ..." (pedida
    // acima, bookkeeping interno) do resto do texto, que continua sendo o prompt de cena de
    // sempre — NUNCA a linha crua chega ao prompt final. Se o modelo não seguiu o formato pedido
    // (padrão defensivo, mesmo espírito do resto deste arquivo: degrada, nunca quebra), resumoCena
    // fica vazio e o texto inteiro segue como prompt, exatamente como antes desta rodada.
    const mResumo = t.match(/\n?SCENE_SUMMARY:\s*(.+?)\s*$/i);
    const resumoCena = mResumo ? mResumo[1].trim().slice(0, 220) : '';
    const texto = mResumo ? t.slice(0, mResumo.index).trim() : t;
    // INSTRUMENTO PERMANENTE — PROMPT E RESPOSTA DO DIRETOR (24/set/2026, "Foto travada de
    // verdade, CTA e selo por código, e enxergar o Diretor", decisão 1, autorizado pelo João) —
    // "gravamos o prompt da imagem, nunca o do Diretor... não é possível saber se o bloco 'não
    // repita' chegou até ele ou chegou e foi ignorado." Antes desta rodada, `sys`/`user`/`t`
    // morriam aqui dentro — nenhum registro sobrevivia depois do retorno. sys é o prompt de
    // SISTEMA completo (inclui o bloco "cenas recentes", a doutrina de material real, a variação —
    // tudo que este arquivo monta pra ele); user é só o Engine 6.0 + o pedido final; t é a resposta
    // BRUTA, ANTES de separar o SCENE_SUMMARY (propositalmente — é o que prova se o modelo seguiu o
    // formato pedido ou não). Threaded por gerarPeca() até conteudos.meta (ver mesclarMetaNaOrdem,
    // mais abaixo) — mesmo padrão já usado por resumoCena.
    return { texto, resumoCena, promptSistema: sys, promptUsuario: user, respostaBruta: t };
  } catch (e) { console.error('diretor:', e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICAÇÃO DE TEXTO POR VISÃO (22/set/2026, "Engine 6.0 como caminho padrão", Rodada 1,
// item 3, autorizado pelo João) — o texto continua sendo renderizado pelo gpt-image-1, como o
// Engine sempre desenhou; a letra certa passa a ser GARANTIDA, não só esperada. Mesmo
// mecanismo da direção avulsa (api/agente-chat.js, commit 87d15c5): tool_choice força saída
// estruturada, o modelo não tem como responder em texto livre.
//
// DECISÃO A REPORTAR AO JOÃO (mesma prática de sempre — interpretação sinalizada, não
// escondida): "confere caractere a caractere, acentos incluídos" — o modelo de visão só
// TRANSCREVE o que lê na imagem (tarefa de OCR, nunca julga sozinho se está certo). A
// comparação caractere a caractere é feita em CÓDIGO, determinística
// (_normalizarParaComparacao + compararTextoLido): normaliza espaço e maiúscula/minúscula (uma
// peça em CAIXA ALTA não é "texto errado" por si só), mas NUNCA remove acento — um "á" virando
// "a" É uma divergência real e continua sendo pega.
// ═══════════════════════════════════════════════════════════════════════════
const TOOL_VERIFICACAO_TEXTO_NOME = 'reportar_texto_lido_na_imagem';
const TOOL_VERIFICACAO_TEXTO = {
  name: TOOL_VERIFICACAO_TEXTO_NOME,
  description: 'Transcreve EXATAMENTE o texto visível na imagem, campo a campo, caractere a caractere (acentos incluídos). Não julgue se está certo ou errado — apenas leia e copie o que está escrito. Campo sem texto correspondente visível na imagem: string vazia. Além disso, verifica se algum elemento importante cai dentro das faixas que serão CORTADAS antes da entrega (a mensagem descreve quais faixas, em percentual).',
  input_schema: {
    type: 'object',
    properties: {
      selo: { type: 'string', description: 'Texto do selo/etiqueta pequena, se houver. String vazia se não houver selo visível.' },
      headline: { type: 'string', description: 'Texto da headline (frase principal, maior destaque visual).' },
      subheadline: { type: 'string', description: 'Texto da subheadline (linha de apoio), se houver. String vazia se não houver.' },
      prova: { type: 'string', description: 'Texto da prova/dado em destaque, se houver. String vazia se não houver.' },
      cta: { type: 'string', description: 'Texto do botão/pílula de CTA, se houver. String vazia se não houver.' },
      // 23/set/2026 ("Corte, mockup e teto de texto", decisão 1, autorizado pelo João): a peça de
      // teste teve label do topo e CTA da base cortados MESMO com a seção 12 declarando a região
      // entregue — instrução em prosa sozinha não bastou (mesmo padrão de outros 7 casos já
      // corrigidos com mecanismo em vez de ênfase textual). Verificação por visão já roda ANTES
      // do corte de verdade e já tem regeneração de uma tentativa — reaproveita os dois.
      elemento_em_faixa_descartada: { type: 'boolean', description: 'true se QUALQUER elemento importante (texto, label, CTA, selo, rosto, logo, borda de mockup) estiver total ou parcialmente dentro de alguma das faixas descritas na mensagem como "serão descartadas". false se todos os elementos importantes estão fora dessas faixas.' },
      descricao_faixa_descartada: { type: 'string', description: 'Quais elementos estão na faixa descartada e em qual borda (ex.: "CTA cortado na faixa inferior; label roçando a faixa do topo"). String vazia se elemento_em_faixa_descartada for false.' },
    },
    required: ['selo', 'headline', 'subheadline', 'prova', 'cta', 'elemento_em_faixa_descartada', 'descricao_faixa_descartada'],
  },
};

// _normalizarParaComparacao: trim + colapsa espaço + minúsculas — NUNCA remove acento (decisão
// acima). Diferença de maiúscula/minúscula sozinha não conta como erro; diferença de acento sim.
function _normalizarParaComparacao(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// compararTextoLido: compara campo a campo o texto ESPERADO (o que foi mandado o Engine
// renderizar) contra o texto LIDO pelo modelo de visão. Só compara campos com texto esperado —
// um campo vazio no esperado nunca gera divergência (o Engine pode legitimamente omitir um
// campo). Retorna a lista de campos divergentes; vazia = tudo confere.
function compararTextoLido(esperados, lidos) {
  const campos = ['selo', 'headline', 'subheadline', 'prova', 'cta'];
  const divergentes = [];
  for (const campo of campos) {
    const esp = String((esperados && esperados[campo]) || '').trim();
    if (!esp) continue; // nada esperado neste campo → nada a conferir
    const lido = (lidos && lidos[campo]) || '';
    if (_normalizarParaComparacao(esp) !== _normalizarParaComparacao(lido)) {
      divergentes.push({ campo, esperado: esp, lido: String(lido).trim() });
    }
  }
  return divergentes;
}

// ═══════════════════════════════════════════════════════════════════════════
// REGENERAÇÃO DIRIGIDA (24/set/2026, "Regeneração dirigida, defeito visível e cena que não se
// repete", decisão 1, autorizado pelo João) — a peça de 24/set provou que reenviarMesmoPrompt()
// mandando o MESMO prompt de novo, sem informação nenhuma do que saiu errado, não corrige nada:
// tentativas=2, e os dois erros de texto E o CTA cortado continuaram idênticos na peça entregue.
// A frase diagnóstica (divergentes[].esperado/lido + faixaDescartada.descricao) já existia — só
// nunca tinha sido repassada ao modelo. montarAdendoCorretivo() monta um texto CURTO, anexado ao
// FIM do prompt já existente (nunca reescreve nada acima) — corrige exclusivamente POSIÇÃO
// (mover o elemento cortado pra dentro da zona segura) e GRAFIA (re-renderizar exatamente os
// campos que saíram errados) — nunca conteúdo, DNA, cena ou regra do Engine (invariante do
// João). Retorna string vazia quando não há nada a corrigir (chamador nunca deveria chegar aqui
// nesse caso, mas a função fica seguindo o mesmo padrão defensivo do resto do arquivo).
function montarAdendoCorretivo(divergentes, faixaDescartada) {
  const partes = [];
  if (Array.isArray(divergentes) && divergentes.length) {
    partes.push(
      'The following field(s) came out WRONG in the previous attempt — re-render ONLY these fields, character-for-character exactly as given here (accents included), and change nothing else about them:\n'
      + divergentes.map(d => '- ' + d.campo + ': render exactly "' + d.esperado + '" (the previous attempt incorrectly rendered "' + d.lido + '")').join('\n')
    );
  }
  if (faixaDescartada && faixaDescartada.em) {
    partes.push(
      'The following element was cropped/cut off in the previous attempt, per section 12\'s safe zones above — reposition ONLY that element so it sits entirely OUTSIDE the discard bands already described there; do not resize, redesign or change what it says, only move it fully into the safe zone:\n- '
      + String(faixaDescartada.descricao || 'elemento importante dentro da faixa que será descartada')
    );
  }
  if (!partes.length) return '';
  return '\n\n=== CORRECTIVE ADDENDUM — DIRECTED REGENERATION (fix ONLY what is listed below — position and/or spelling. Everything else about this piece, its content, its scene, the brand DNA and every rule above stays EXACTLY as already instructed) ===\n'
    + partes.join('\n\n');
}

// DEFEITO VISÍVEL (24/set/2026, decisão 2 da mesma ordem, autorizado pelo João) — a peça de
// 24/set foi entregue como aguardando_aprovacao sem aviso nenhum visível ("o usuário descobriu
// 'PLANS PRS' no olho"), com o defeito já gravado em meta.verificacao_texto mas sem nenhum texto
// que resumisse isso pro humano que vai aprovar. montarAlertaDefeito() lê a verificação FINAL
// (a que efetivamente foi mantida/entregue — nunca a 1ª tentativa descartada) e, só quando ela
// ainda tem divergência de texto OU elemento em faixa descartada, monta um aviso legível em
// português — persistido em meta.alerta_defeito (ver ponto de gravação) e exibido em
// aprovar.html. ACHADO (autoencontrado, reportado, não é bug desta rodada): o badge que já
// existia em aprovar.html (linha ~902, "✏️ TEXTO DIVERGENTE") só olhava pra divergentes — uma
// peça com texto 100% certo mas elemento cortado (faixaDescartada.em=true, divergentes=[])
// nunca disparava aviso nenhum. alerta_defeito cobre os dois casos juntos.
function montarAlertaDefeito(verificacaoFinal) {
  if (!verificacaoFinal) return '';
  const partes = [];
  if (Array.isArray(verificacaoFinal.divergentes) && verificacaoFinal.divergentes.length) {
    partes.push('texto divergente do esperado — ' + verificacaoFinal.divergentes.map(d => d.campo + ': saiu "' + d.lido + '" (esperado "' + d.esperado + '")').join('; '));
  }
  if (verificacaoFinal.faixa_descartada && verificacaoFinal.faixa_descartada.em) {
    // .replace: a descrição da visão já vem pontuada ("...da imagem.") — sem isso o alerta saía
    // com ponto duplicado antes de "Revise com atenção..." (achado de polimento, não funcional).
    partes.push(String(verificacaoFinal.faixa_descartada.descricao || 'elemento importante cai na faixa que será cortada na entrega').replace(/\.+\s*$/, ''));
  }
  if (!partes.length) return '';
  return 'Esta peça foi entregue com defeito conhecido mesmo após a regeneração automática — ' + partes.join(' · ') + '. Revise com atenção antes de aprovar.';
}

// verificarTextoPorVisao: envia os bytes da imagem já em mãos (sem novo fetch — PNG cru da
// OpenAI, antes do corte, ver ponto de chamada) + a lista de textos esperados a um modelo com
// visão, tool_choice forçado na única ferramenta possível.
// FALHA DE INFRAESTRUTURA (rede, JSON malformado, bloco ausente) LANÇA Error — distinto de
// "verificou e divergiu" (retorno normal, possivelmente com divergentes). Quem chama nunca deve
// tratar uma falha de infraestrutura como divergência: isso dispararia regeneração às cegas, o
// oposto do que esta verificação existe para evitar.
// regiaoEntregue (23/set/2026, decisão 1 acima): a MESMA geometria que calcularZonaExclusao() já
// calcula e que engine6() seção 12 já declara ao modelo de IMAGEM — nunca recalculada nem
// hardcodada aqui de novo, só reaproveitada pra descrever as faixas ao modelo de VISÃO.
async function verificarTextoPorVisao(bytesImagem, esperados, mediaType, regiaoEntregue) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('sem ANTHROPIC_API_KEY');
  const b64 = bytesImagem.toString('base64');
  const listaEsperada = ['selo', 'headline', 'subheadline', 'prova', 'cta']
    .map(c => `${c}: ${JSON.stringify(String((esperados && esperados[c]) || ''))}`)
    .join('\n');
  const descricaoFaixas = (regiaoEntregue && (regiaoEntregue.descarteAltura > 0.001 || regiaoEntregue.descarteLargura > 0.001))
    ? ('\n\nEsta imagem será CORTADA antes da entrega ao cliente: '
        + (regiaoEntregue.descarteAltura > 0.001 ? ('a faixa do TOPO e a faixa da BASE, ' + fmtPct(regiaoEntregue.descartePorBorda) + ' da altura cada uma (' + fmtPct(regiaoEntregue.descarteAltura) + ' da altura total), serão descartadas. ') : '')
        + (regiaoEntregue.descarteLargura > 0.001 ? ('a faixa da ESQUERDA e a faixa da DIREITA, ' + fmtPct(regiaoEntregue.descartePorLado) + ' da largura cada uma (' + fmtPct(regiaoEntregue.descarteLargura) + ' da largura total), serão descartadas. ') : '')
        + 'Olhe atentamente se algum elemento importante (texto, label, CTA, selo, rosto, logo, borda de mockup) está total ou parcialmente dentro dessas faixas — ele será cortado fora na entrega final, mesmo que pareça só "roçando" a borda.')
    : '';
  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: b64 } },
    { type: 'text', text: 'Estes são os textos que deveriam aparecer nesta peça (campo: texto esperado — pode estar vazio se o campo não se aplica a esta peça):\n' + listaEsperada + descricaoFaixas + '\n\nUse a ferramenta para transcrever exatamente o que está escrito em cada campo visível na imagem, e reportar também se algum elemento está dentro da faixa que será descartada.' },
  ];
  // Mesmo padrão dual-attempt do Diretor (acima): 1ª tentativa com output_config (raciocínio
  // baixo, cabe no tempo da função), repete sem output_config antes de desistir — nunca troca de
  // modelo nem larga tools/tool_choice no caminho (mesma trava da direção avulsa: falhar visível
  // é preferível a degradar em silêncio pra texto livre).
  const chamar = (extra) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_VERIFICACAO_TEXTO(), max_tokens: 1000, messages: [{ role: 'user', content: userContent }], tools: [TOOL_VERIFICACAO_TEXTO], tool_choice: { type: 'tool', name: TOOL_VERIFICACAO_TEXTO_NOME }, ...extra }),
  });
  let r = await chamar({ output_config: { effort: 'low' } });
  if (!r.ok) r = await chamar({});
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    throw new Error('verificação por visão falhou: ' + corpo.slice(0, 200));
  }
  const data = await r.json();
  const bloco = (data.content || []).find(c => c && c.type === 'tool_use' && c.name === TOOL_VERIFICACAO_TEXTO_NOME);
  if (!bloco || !bloco.input || typeof bloco.input !== 'object') throw new Error('verificação por visão: tool_choice forçado não retornou o bloco esperado');
  return { lidos: bloco.input, modelo: MODEL_VERIFICACAO_TEXTO() };
}

// ═══════════════════════════════════════════════════════════════════════════
// COERÊNCIA DE CONTEÚDO (24/set/2026, "Foto travada de verdade, CTA e selo por código, e
// enxergar o Diretor", decisão 5, autorizado pelo João) — a verificação por visão (acima) só
// compara o RENDERIZADO contra o ESPERADO — nunca checa se o ESPERADO é coerente consigo mesmo.
// A peça real de 24/set 20:32 provou o buraco: headline "Quanto tempo você recupera com 8
// agentes?", prova "5 agentes especializados" NA MESMA peça (confirmado via SQL) — divergência de
// fato dentro do próprio conteúdo PLANEJADO, nunca gerada pelo modelo de imagem, então a
// verificação por visão nunca poderia pegá-la (o objeto `esperado` dela é montado dos MESMOS
// campos — comparar um contra o outro não seria comparação nenhuma).
// Roda ANTES de montar qualquer prompt (a peça nunca é gerada em silêncio com um número que já
// nasceu contraditório) — compara headline+subheadline+prova+cta ENTRE SI e contra fatos que o
// próprio DNA da marca já declara. Escopo estrito, pedido pelo João: só contradição OBJETIVA de
// número/fato (duas contagens diferentes da mesma coisa, preço divergente, dado que contradiz o
// DNA) — nunca estilo, tom ou preferência de redação, isso não é o que "não fecha" pede.
// NÃO BLOQUEIA a geração — "não gera imagem em silêncio" pede um AVISO visível, nunca uma recusa;
// a peça é gerada normalmente e marcada com o mesmo alerta legível que já existe (alerta_defeito,
// ver montarAlertaDefeito e o ponto de mesclarMetaNaOrdem, mais abaixo).
// FALHA DE INFRAESTRUTURA nunca bloqueia a peça (mesmo princípio do resto do arquivo): sem
// ANTHROPIC_API_KEY, erro de rede ou resposta fora do formato esperado, segue sem checar — nunca
// um alerta inventado, nunca uma peça travada por causa da própria checagem.
// ═══════════════════════════════════════════════════════════════════════════
const MODEL_COERENCIA = () => trimEnv(process.env.AGENT_MODEL_COERENCIA) || 'claude-sonnet-5';
const TOOL_COERENCIA_NOME = 'reportar_coerencia_do_conteudo';
const TOOL_COERENCIA = {
  name: TOOL_COERENCIA_NOME,
  description: 'Reporta se os campos de texto desta peça publicitária são coerentes entre si e com os fatos que o DNA da marca declara.',
  input_schema: {
    type: 'object',
    properties: {
      coerente: { type: 'boolean', description: 'true se não há nenhuma contradição objetiva de número ou fato entre headline, subheadline, prova e CTA, nem contra os fatos do DNA da marca. false se houver.' },
      alerta: { type: 'string', description: 'Quando coerente=false: uma frase curta em português dizendo exatamente o que não fecha (ex.: "headline diz 8 agentes, prova diz 5 agentes"). String vazia quando coerente=true.' },
    },
    required: ['coerente', 'alerta'],
  },
};
async function checarCoerenciaConteudo(M, o) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const campos = { headline: o.headline || '', subheadline: o.subheadline || '', prova: o.prova || '', cta: o.cta_arte || '' };
  if (!Object.values(campos).some(v => String(v).trim())) return null; // nada a checar
  const fatosDna = [
    M.produtos_precos ? ('O que a marca vende / preços: ' + String(M.produtos_precos).slice(0, 300)) : '',
    M.posicionamento ? ('Posicionamento: ' + String(M.posicionamento).slice(0, 200)) : '',
    M.marca ? ('Marca: ' + M.marca) : '',
  ].filter(Boolean).join('\n');
  const userContent = [{
    type: 'text',
    text: 'Estes são os campos de texto de UMA peça publicitária (todos da MESMA peça — precisam ser coerentes entre si):\n'
      + Object.entries(campos).map(([k, v]) => k + ': ' + JSON.stringify(v)).join('\n')
      + (fatosDna ? ('\n\nFatos que o DNA da marca já declara (a peça não pode contradizer):\n' + fatosDna) : '')
      + '\n\nUse a ferramenta para reportar APENAS contradição OBJETIVA de número ou fato (ex.: duas contagens diferentes da mesma coisa, preço divergente, dado que contradiz o DNA) — nunca estilo, tom, opinião ou preferência de redação.',
  }];
  // Mesmo padrão dual-attempt de diretorDeArte()/verificarTextoPorVisao (acima): 1ª tentativa com
  // output_config (raciocínio baixo), repete sem ele antes de desistir.
  const chamar = (extra) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_COERENCIA(), max_tokens: 400, messages: [{ role: 'user', content: userContent }], tools: [TOOL_COERENCIA], tool_choice: { type: 'tool', name: TOOL_COERENCIA_NOME }, ...extra }),
  });
  try {
    let r = await chamar({ output_config: { effort: 'low' } });
    if (!r.ok) r = await chamar({});
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      console.error('[coerencia] falha de infraestrutura, seguindo sem checar:', corpo.slice(0, 200));
      return null;
    }
    const data = await r.json();
    const bloco = (data.content || []).find(c => c && c.type === 'tool_use' && c.name === TOOL_COERENCIA_NOME);
    if (!bloco || !bloco.input || typeof bloco.input !== 'object') return null;
    if (bloco.input.coerente) return null;
    const alerta = String(bloco.input.alerta || '').trim();
    return alerta || 'conteúdo incoerente detectado, sem detalhe do modelo';
  } catch (e) {
    console.error('[coerencia] falha de infraestrutura, seguindo sem checar:', e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // DIAGNÓSTICO: GET ?diag=1 → informa se a chave existe e testa a OpenAI (sem gastar imagem cara)
  if (req.method === 'GET' && req.query && req.query.diag) {
    const temChave = !!process.env.OPENAI_API_KEY;
    let openai = 'não testado';
    if (temChave) {
      try {
        const t = await fetch('https://api.openai.com/v1/models/gpt-image-1', {
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        });
        const tj = await t.json();
        openai = t.ok ? 'gpt-image-1 ACESSÍVEL ✅' : ('ERRO: ' + JSON.stringify(tj.error || tj).slice(0, 200));
      } catch (e) { openai = 'falha de rede: ' + e.message; }
    }
    let diretor = 'sem ANTHROPIC_API_KEY ❌';
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        // Mesma defesa de duas tentativas de diretorDeArte() (18/set/2026, causa real confirmada:
        // faltava output_config:{effort:'low'} — o literal do modelo já era válido). O diagnóstico
        // agora distingue os três estados possíveis: funcionou direto, funcionou só na repetição
        // (sinal de que o output_config é mesmo o fator), ou falhou nas duas.
        let t = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 4, messages: [{ role: 'user', content: 'oi' }], output_config: { effort: 'low' } }),
        });
        if (t.ok) { diretor = MODEL_DIRETOR() + ' ACESSÍVEL ✅ (direto, com output_config)'; }
        else {
          t = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 4, messages: [{ role: 'user', content: 'oi' }] }),
          });
          if (t.ok) { diretor = MODEL_DIRETOR() + ' ACESSÍVEL ✅ (na repetição, sem output_config)'; }
          // NADA FALHA EM SILÊNCIO (17/set/2026): antes só `error.message` ia pro diagnóstico —
          // "model: X" sozinho não diz se é modelo inexistente, sem acesso na conta, ou outra causa.
          // `error.type` (not_found_error/permission_error/invalid_request_error/...) é a
          // classificação real que a Anthropic manda; sem ela o diagnóstico via ?diag=1 fica cego
          // sobre O PORQUÊ, só sabe QUE falhou.
          else { const j = await t.json().catch(() => ({})); diretor = 'FALHOU ❌ nas duas tentativas [' + String((j.error && j.error.type) || 'sem-type') + '] ' + String((j.error && j.error.message) || t.status).slice(0, 110); }
        }
      } catch (e) { diretor = 'erro: ' + e.message; }
    }
    return res.status(200).json({
      diagnostico: true,
      versao: VERSAO,
      modos: 'CENA (foto real, texto = objeto físico) | EDITORIAL (zonas: chapado + foto full-bleed)',
      tem_OPENAI_API_KEY: temChave,
      teste_openai: openai,
      diretor_de_arte: diretor,
      engine_6_ativo: true,
      logo_enviada_ao_gerador: false,
      input_fidelity: 'high',
      // ATUALIZADO (22/set/2026, "Engine 6.0 como caminho padrão" Rodada 1, item 1): a frase
      // antiga aqui ("a fidelidade vem do rulebook, não da qualidade") nunca foi testada com o
      // Diretor de Arte funcionando — ele esteve quebrado por ~2 meses até 18/09, então quase
      // toda comparação feita até então era contra um pipeline sem direção de arte nenhuma. Essa
      // premissa não tinha base; 'medium' virou 'high' nas duas chamadas ao gpt-image-1
      // (images/edits e images/generations) — o chat que o cliente usa como referência roda em
      // alta, o pipeline não tinha por que rodar abaixo disso.
      quality: 'high (revisado 22/set/2026 — premissa anterior de custo/desempenho nunca foi testada com o Diretor funcionando)',
      contrato_preservacao: 'moldura (abre e fecha) + duas colunas TRAVADO/LIBERADO + lista enumerada',
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    // Auth
    // ── VIA INTERNA (worker do cron): produção server-side roda sem navegador aberto.
    //    Autenticada por segredo de servidor — nunca exposto ao cliente.
    const _int = req.headers['x-internal-secret'];
    const _intOk = _int && process.env.CRON_SECRET && _int === process.env.CRON_SECRET;
    let _intUser = null;
    if (_intOk && req.body && req.body.user_id) _intUser = String(req.body.user_id);

    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!jwt && !_intUser) return res.status(401).json({ error: 'Não autenticado' });
    const uRes = _intUser ? { ok: true, json: async () => ({ id: _intUser }) } : await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` } });
    const user = await uRes.json();
    if (!uRes.ok || !user.id) return res.status(401).json({ error: 'Sessão inválida' });

    // Cliente + plano + limites de imagem
    // Solicitante (quem está logado — pode ser supervisor/admin)
    const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user.id}&select=id,role`, { headers: SBH() });
    const [requester] = await reqRes.json();
    if (!requester) return res.status(403).json({ error: 'Conta não encontrada' });

    // ALVO: por padrão o próprio; se vier ver_id e o solicitante tiver permissão, usa o alvo
    let targetId = user.id;
    const verId = (req.body && req.body.ver_id) || null;
    if (verId && verId !== user.id) {
      if (requester.role === 'admin') {
        targetId = verId; // admin acessa qualquer conta
      } else if (requester.role === 'supervisor') {
        // valida que o alvo é supervisionado por este supervisor
        const supRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${verId}&supervisor_id=eq.${user.id}&select=id`, { headers: SBH() });
        const sup = await supRes.json();
        if (Array.isArray(sup) && sup.length) targetId = verId;
        else return res.status(403).json({ error: 'Sem permissão sobre esta conta' });
      } else {
        return res.status(403).json({ error: 'Sem permissão' });
      }
    }

    // AÇÃO 'registrar' (Aceitar): grava a arte já gerada em Meus Arquivos + vincula ao conteúdo.
    // Não gera imagem nova nem consome cota — só persiste o que o usuário aprovou no preview.
    if (req.body && req.body.acao === 'registrar') {
      const { url, path, nome, conteudo_id } = req.body;
      if (!url) return res.status(400).json({ error: 'URL da imagem ausente' });
      const rIns = await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
        method: 'POST', headers: SBH(),
        body: JSON.stringify({ user_id: targetId, categoria: 'gerados', nome: nome || 'Arte IA', url, path: path || null }),
      });
      if (!rIns.ok) { const t = await rIns.text(); return res.status(500).json({ error: 'Falha ao salvar em Meus Arquivos', detalhe: t.slice(0, 160) }); }
      if (conteudo_id) await gravarSlide(conteudo_id, url, req.body.slide, req.body.total);
      return res.status(200).json({ ok: true, registrado: true });
    }

    // Carrega a conta ALVO (dona dos dados: logo, OS_DATA, uso, limites)
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}&select=*`, { headers: SBH() });
    const [cli] = await cRes.json();
    if (!cli) return res.status(403).json({ error: 'Conta não encontrada' });
    if (cli.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });
    // COMPOSIÇÃO — INTERRUPTOR (22/set/2026, Fase 1): lido de clientes.preferencias, desligado por
    // padrão. Clientes sem o interruptor seguem o caminho atual sem mudança nenhuma. A decisão
    // FINAL de compor esta peça específica (composicaoAtivaEfetiva) ainda depende do modo
    // resolvido (só EDITORIAL nesta fase — CENA fica para a Fase 2, ver _composicao-lib.js) e é
    // calculada mais abaixo, dentro de gerarPeca(). engine===false (ficha técnica) nunca compõe —
    // não é post de Instagram, não carrega headline/subheadline/cta_arte.
    const composicaoLigada = !!(cli.preferencias && cli.preferencias.composicao_ativa);

    // Reset mensal do uso de imagens
    const mes = new Date().toISOString().slice(0, 7);
    let uso = cli.uso || {};
    if (uso.mes !== mes) { uso = { tokens: 0, imagens: 0, reloads: 0, videos: 0, mes }; }
    let lim = cli.limites || {};
    // permitir_invencao_headline: SÓ os dois ramos de fallback nomeados do laço de ordens
    // (agentes.html) mandam este campo — ver validarTextoDaPeca e o comentário em diretorDeArte.
    const { prompt, tamanho, tipo, slide, conteudo_id, reload, registrar, headline, subheadline, prova, cta_arte, copy, oferta, formato, pilar, total, engine, variacao, ajuste, modo, origem, sem_foto_pessoa, permitir_invencao_headline } = req.body || {};

    // ── COTA DE TRIAL ──
    // Se o cliente está dentro do período de teste (cortesia_ate no futuro),
    // a cota de imagens/reloads é reduzida. Após o trial, libera a cota cheia.
    let emTrial = false;
    try {
      if (cli.cortesia_ate && new Date(cli.cortesia_ate).getTime() > Date.now() && cli.tipo_cortesia === 'trial') {
        emTrial = true;
        const tRes = await fetch(`${SUPABASE_URL}/rest/v1/config?chave=eq.trial&select=valor&limit=1`, { headers: SBH() });
        const tj = await tRes.json();
        const trial = (Array.isArray(tj) && tj[0] && tj[0].valor) ? tj[0].valor : { reloads: 2 };
        // TRIAL: limite de imagens por plano (básico 1, plus 2, pro 3) — o funil mostra qualidade, não quantidade
        // Gate do funil: no trial, o Designer só trabalha DEPOIS do onboarding (check-in concluído).
        // Evita uso avulso sem estratégia — a imagem do trial deve mostrar o sistema funcionando.
        const fezOnboarding = !!(cli.onboarding && cli.onboarding.checkin);
        if (!fezOnboarding && cli.role === 'usuario') {
          return res.status(403).json({ error: 'Durante o teste, complete primeiro a consultoria com o agente de Identidade (o check-in). Assim o Designer cria artes com a cara da SUA marca. 😉', limite: true });
        }
        const imgTrial = { basico: 1, plus: 2, pro: 3 }[cli.plano || 'basico'] || 1;
        // limite efetivo = o MENOR entre a cota do plano e a cota de trial
        lim = {
          ...lim,
          imagens: Math.min(Number(lim.imagens ?? 0), imgTrial),
          reloads: Math.min(Number(lim.reloads ?? 0), Number(trial.reloads ?? 2)),
        };
      }
    } catch (e) {}

    // ── RESERVA DA VIA EXPRESSA (80/20) ──
    // O lote da semana NUNCA pode comer a cota inteira: 20% fica reservado ao pedido de
    // última hora do humano. Sem isto o robô gerava as 10 artes do plano e, quando o dono
    // pedia um post urgente, não sobrava imagem — foi exatamente o que aconteceu.
    // Validado no SERVIDOR: o front não burla mandando origem:'expressa'.
    const TETO_LOTE = 0.8;
    // PISO: abaixo de 5 imagens/mês não existe 80/20 — floor(1*0.8)=0 e o lote nasceria MORTO
    // (o trial básico tem cota 1: o cliente clicaria "Gerar as artes" e levaria 403 antes da
    // primeira arte). Com cota pequena não há o que repartir: a fila por prioridade já protege
    // o humano, que passa na frente do robô de qualquer forma.
    const RESERVA_MIN = 5;
    if (!reload && String(origem || '') === 'lote' && lim.imagens != null && Number(lim.imagens) >= RESERVA_MIN) {
      const teto = Math.floor(Number(lim.imagens) * TETO_LOTE);
      if (Number(uso.imagens || 0) >= teto) {
        return res.status(403).json({
          error: `A fila automática já usou as ${teto} imagens reservadas ao plano (de ${lim.imagens}). O resto fica guardado para os seus pedidos de última hora.`,
          limite: true, tipo_limite: 'reserva', reserva: true, teto,
        });
      }
    }

    const ehReload = !!reload;
    if (ehReload) {
      if (lim.reloads != null && Number(uso.reloads || 0) >= Number(lim.reloads)) {
        return res.status(403).json({ error: emTrial ? 'Você atingiu a cota de recriações do período de teste. Sua cota completa será liberada após os 7 dias.' : 'Limite mensal de recriações (reloads) atingido.', limite: true, tipo_limite: 'reload', trial: emTrial });
      }
    } else {
      if (lim.imagens != null && Number(uso.imagens || 0) >= Number(lim.imagens)) {
        return res.status(403).json({ error: emTrial ? 'Você atingiu a cota de imagens do período de teste. Sua cota completa será liberada após os 7 dias.' : 'Limite mensal de criações de imagem atingido.', limite: true, tipo_limite: 'imagem', trial: emTrial });
      }
    }

    if (!prompt || prompt.length < 10) return res.status(400).json({ error: 'Prompt inválido' });
    // ETAPA 1 — TEXTO VALIDADO EM CÓDIGO (16/set/2026): engine===false é a ficha técnica (brand
    // board) — não é post de Instagram, não carrega headline/subheadline/cta_arte nenhum (ver
    // agentes.html, gerarFichaTecnica: txt vem vazio de propósito) — fora do escopo desta
    // validação, que é sobre TEXTO DE PEÇA. Recusa a PEÇA INTEIRA (não só o campo): mesmo
    // contrato do gate de prompt logo acima e de cardinalidade() em agente-chat.js — nenhuma
    // imagem é gerada, nenhum crédito de cota é gasto, o erro nomeia o campo e a contagem.
    if (engine !== false) {
      try {
        validarTextoDaPeca({ headline, subheadline, cta_arte }, !!permitir_invencao_headline);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }
    // gpt-image-1 só aceita: 1024x1024 (1:1), 1024x1536 (retrato 2:3), 1536x1024 (paisagem 3:2).
    // '9:16' NÃO existe aqui — antes caía no else e virava QUADRADO (reels saía cortado).
    // Proporção derivada do FORMATO (fonte da verdade), nunca cai em quadrado por engano:
    // feed/carrossel = 4:5 ; story/reels/vídeo = 9:16. O gpt-image-1 só entrega retrato 2:3
    // (o mais próximo dos dois), landscape 3:2 ou 1:1 — então 4:5 e 9:16 vão para o RETRATO.
    const _fmt = String(formato || '').toLowerCase();
    // FONTE ÚNICA (25/ago/2026): este é o ponto que de fato decide o corte final da imagem (ver
    // o crop mais abaixo, que usa esta mesma variável) — um 10º ponto que escapou do mapeamento
    // original por estar num regex literal (/reel|story.../), não numa string com aspas.
    // Antes também batia em 'video'/'vídeo': sem efeito prático — conteúdo desses formatos é
    // MATERIAL_USUARIO e nunca chega a esta chamada por nenhum caminho legítimo hoje.
    const _vertical = JC.ehVertical(_fmt);
    const t = String(tamanho || (_vertical ? '9:16' : '4:5'));
    const size = (t === '16:9') ? '1536x1024' : (t === '1:1') ? '1024x1024' : '1024x1536';
    // O Diretor precisa saber a TELA REAL, senão compõe para um formato que não existe.
    const canvas = size === '1024x1536' ? '1024x1536 portrait (2:3)' : size === '1536x1024' ? '1536x1024 landscape (3:2)' : '1024x1024 square (1:1)';
    // FONTE ÚNICA DO ALVO DE CORTE (22/set/2026, "Engine 6.0 Rodada 2", Causa 1, autorizado
    // pelo João): _alvoRecorte nasce AQUI, uma vez só, e é reusado tanto pelo texto do prompt
    // (via o.alvoRecorte/o.regiaoEntregue em engine6, seção 12) quanto pelo crop de verdade
    // (mais abaixo, depois de compor()/logo) — antes eram dois literais `{w:1080,h:...}`
    // duplicados que podiam divergir silenciosamente. _regiaoEntregue é o cálculo de quanto
    // desse corte é descartado e quais margens efetivas isso implica sobre o canvas GERADO
    // (ver calcularZonaExclusao, acima de engine6) — hoje `size` é sempre '1024x1536' na
    // prática (nenhum caller passa '1:1'/'16:9' pra post real, ver grep registrado em
    // APRENDIZADOS.md), mas o cálculo é dinâmico a partir de `size`/`_alvoRecorte`, não
    // hardcoded por formato, pra não repetir esse acoplamento implícito.
    const [_genW, _genH] = size.split('x').map(Number);
    const _alvoRecorte = _vertical ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 };
    const _regiaoEntregue = calcularZonaExclusao(_genW, _genH, _alvoRecorte.w, _alvoRecorte.h, MARGENS_BASE_SAFE_ZONE[_vertical ? 'reels' : 'feed']);
    // INSTRUMENTO PERMANENTE — CUSTO E TEMPO POR CHAMADA À OPENAI (24/set/2026, "Trocar o motor
    // de imagem e reservar as zonas das pílulas", "Alterações" item 4, autorizado pelo João).
    // Populado DENTRO de chamarOpenAIImageToImage/chamarOpenAITextToImage (mais abaixo, únicas
    // duas funções que de fato chamam a OpenAI — toda regeneração, inclusive reenviarMesmoPrompt
    // e o fallback de composição, passa por uma das duas). O `usage` de cada chamada só é
    // conhecido depois que o CHAMADOR já consumiu a resposta (`.json()`, corpo consumível uma
    // única vez) — por isso é anexado ao ÚLTIMO item deste array no ponto de chamada, nunca
    // recalculado aqui. Seguro por execução estritamente sequencial: este handler nunca dispara
    // duas chamadas à OpenAI em paralelo (sem Promise.all entre elas em nenhum caminho).
    const _chamadasOpenAI = [];

    // Buscar imagens base do acervo: logo SEMPRE; foto pessoal se for post de pessoa
    // OS_DATA REAL: sem isto o prompt pedia "siga a identidade visual" sem NUNCA enviar as cores/fontes.
    const M6 = {};
    try {
      // FONTE ÚNICA DO DNA (23/set/2026, "DNA da marca — camada VISUAL_SYSTEM", achado 6 do
      // João, autorizado): faltava &agente=eq.global aqui — mesmo filtro que agente-chat.js já
      // aplica (ver fontes/filtroMem, mais acima no outro arquivo). Sem ele, QUALQUER memória
      // não-global do mesmo user_id com chave colidente (ex.: um agente registra um rascunho
      // próprio sob uma chave que também é DNA global) sobrescreve o DNA da marca em silêncio —
      // a ordem de chegada das linhas do banco decide qual valor "ganha", não a intenção. Este
      // M6 alimenta só o Engine (engine6()); memórias por-agente nunca deveriam entrar aqui.
      const mems = await fetch(`${SUPABASE_URL}/rest/v1/memorias?user_id=eq.${targetId}&agente=eq.global&select=chave,valor`, { headers: SBH() }).then(r => r.json());
      (Array.isArray(mems) ? mems : []).forEach(m => { M6[m.chave] = m.valor; });
    } catch (e) {}
    // SINAL DE DNA INCOMPLETO (22/set/2026, "Engine 6.0 Rodada 2", Causa 2, autorizado pelo
    // João): "para quem já está com a conta em uso: quando a geração roda com algum obrigatório
    // ausente, registrar em log e em conteudos.meta quais faltaram. Assim a causa fica visível
    // na peça, em vez de invisível." Log SEMPRE (mesmo sem conteudo_id — preview avulso também
    // deve aparecer nos logs da Vercel); a gravação em conteudos.meta acontece mais abaixo,
    // mesclada na MESMA escrita que já grava prompt_final (nunca uma corrida de PATCHes
    // concorrentes na mesma ordem). Só leitura — este código nunca escreve valor no DNA.
    const _dnaFaltando = dnaFaltando(M6);
    if (_dnaFaltando.length) {
      console.error('[dna-incompleto] geração rodando com DNA obrigatório ausente para user_id=' + targetId + ':', _dnaFaltando.join(', '));
    }

    // COERÊNCIA ANTES DE GERAR (24/set/2026, "Foto travada de verdade, CTA e selo por código, e
    // enxergar o Diretor", decisão 5, autorizado pelo João) — roda ANTES de montar qualquer
    // prompt, com o conteúdo planejado da peça (headline/subheadline/prova/cta_arte) e o DNA (M6,
    // já populado acima) — nunca depois, nunca sobre o que o modelo de imagem desenhou (isso é o
    // que a verificação por visão já faz, é outra checagem, outro objetivo). engine===false
    // (ficha técnica) não carrega texto de peça — mesmo escopo de validarTextoDaPeca, acima.
    let _alertaCoerencia = '';
    if (engine !== false) {
      try {
        _alertaCoerencia = await checarCoerenciaConteudo(M6, { headline, subheadline, prova, cta_arte }) || '';
        if (_alertaCoerencia) console.error('[coerencia] divergência detectada antes de gerar:', _alertaCoerencia);
      } catch (e) { console.error('[coerencia] falha inesperada, seguindo sem checar:', e.message); }
    }

    // ZONAS RESERVADAS DAS PÍLULAS (24/set/2026, decisão 5, autorizado pelo João) — calculada
    // CEDO, antes de montar qualquer prompt, com calcularZonasPills (FONTE ÚNICA, ver definição
    // acima de engine6). M6/pilar/cta_arte/total já existem neste ponto (M6 populado acima,
    // pilar/cta_arte/total vêm do req.body, desestruturados no topo do handler — nenhum dos três
    // muda depois daqui). O resultado alimenta tanto o.zonasPills (declaração ao modelo, dentro de
    // oArte/oArte2 mais abaixo) quanto o desenho de verdade (bloco `if (!logoJaComposta)`, mais
    // abaixo), que passa a REUSAR _zonasPills em vez de recalcular — nunca duas contas
    // divergentes. engine===false (ficha técnica) não carrega pilar/cta_arte de peça de verdade —
    // mesmo escopo de validarTextoDaPeca/checarCoerenciaConteudo, acima.
    // GATED POR CTA_SELO_POR_CODIGO (25/set/2026, "Devolver CTA e selo ao modelo...", decisão 1) —
    // com a chave desligada (padrão atual), nem a reserva antecipada nem o desenho de verdade
    // (bloco `if (!logoJaComposta)`, mais abaixo) rodam — sem isso, o código continuaria
    // carimbando pílulas por CIMA do que o modelo agora desenha sozinho (o próprio defeito que
    // motivou esta reversão), mesmo com a declaração ao modelo (engine6) já suprimida.
    let _zonasPills = null;
    if (CTA_SELO_POR_CODIGO && engine !== false) {
      try {
        _zonasPills = await calcularZonasPills(_vertical, M6, pilar, cta_arte, total, targetId);
      } catch (e) { console.error('[zonas-pills] cálculo antecipado falhou, prompt e composição seguem sem reserva:', e.message); }
    }
    // Traduzida pro canvas GERADO (o que o modelo de imagem desenha, ANTES do corte) — mesma
    // matemática de calcularZonaExclusao, função IRMÃ nova (mapearRetParaGerado, acima) porque
    // calcularZonaExclusao está na lista do que esta rodada não altera.
    const _zonasPillsGeradas = _zonasPills ? {
      selo: _zonasPills.selo ? mapearRetParaGerado(_genW, _genH, _alvoRecorte.w, _alvoRecorte.h, _zonasPills.selo) : null,
      cta: _zonasPills.cta ? mapearRetParaGerado(_genW, _genH, _alvoRecorte.w, _alvoRecorte.h, _zonasPills.cta) : null,
    } : null;

    // CENA COM MEMÓRIA (24/set/2026, "Regeneração dirigida, defeito visível e cena que não se
    // repete", decisão 3, autorizado pelo João) — FONTE ÚNICA, buscada uma vez só (mesmo padrão
    // de M6/_dnaFaltando acima), nunca recalculada dentro de gerarPeca() nem por chamada. Busca
    // até 5 peças recentes do MESMO cliente (não só 3 — algumas podem não ter cena_resumo
    // gravado: ficha técnica com engine:false, peças de antes desta rodada, ou o Diretor sem
    // responder no formato pedido) e fica só com os 3 primeiros resumos não-vazios, na ordem mais
    // recente primeiro. id=neq.conteudo_id evita que uma REGERAÇÃO da própria peça (mesmo
    // conteudo_id, chamada de novo) conte a si mesma como "cena recente" antes de escrever seu
    // próprio resumo novo. Nas primeiras peças de uma conta o array sai vazio — comportamento
    // idêntico ao de antes desta rodada, esperado (efeito só a partir da 3ª peça com histórico).
    let _cenasRecentes = [];
    try {
      const qCenas = `${SUPABASE_URL}/rest/v1/conteudos?user_id=eq.${targetId}${conteudo_id ? ('&id=neq.' + conteudo_id) : ''}&select=meta&order=created_at.desc&limit=5`;
      const recentes = await fetch(qCenas, { headers: SBH() }).then(r => r.json());
      _cenasRecentes = (Array.isArray(recentes) ? recentes : [])
        .map(c => c && c.meta && c.meta.cena_resumo)
        .filter(s => s && String(s).trim())
        .slice(0, 3);
    } catch (e) { console.error('[cena-memoria] busca de cenas recentes falhou, seguindo sem histórico:', e.message); }

    const baseImgs = [];
    async function baixarImg(url) {
      try {
        const ir = await fetch(url);
        if (!ir.ok) return null;
        const ct = (ir.headers.get('content-type') || 'image/png').split(';')[0];
        if (!/image\/(png|jpe?g|webp)/.test(ct)) return null;
        const buf = Buffer.from(await ir.arrayBuffer());
        if (buf.length > 24000000) return null; // gpt-image-1: <25MB por imagem
        return { buf, ct };
      } catch (e) { return null; }
    }
    try {
      // LOGO: NÃO enviamos ao gerador. O Engine 6.0 é explícito ("este sistema gera imagens SEM logo"
      // e proíbe símbolo/ícone/emblema): o gpt-image-1 SEMPRE redesenha a logo de referência e a
      // distorce. A assinatura da marca sai como TEXTO simples (permitido pelo Engine); o PNG
      // original será sobreposto por código numa próxima etapa.
      // REGRA CARROSSEL: foto/produto reais SÓ no primeiro slide (capa).
      const primeiroSlide = (slide === undefined || slide === null || Number(slide) <= 1);
      // TIPO 'pessoal' = FOTO REAL do cliente (preservação). Só no 1º slide.
      // TETO 40%: o lote conta quantas artes já usaram a pessoa e manda sem_foto_pessoa quando estoura
      // (Engine 6.0: "foto pessoa = 2 slides max em 5"). Aí a peça vira conceitual em vez de saturar.
      // BUG CORRIGIDO (20/set/2026, "preservação de material real", autorizado pelo João): até aqui
      // esta condição também incluía 'pessoa_conceito' — o comentário duas seções abaixo ("TIPO
      // 'pessoa_conceito'... NÃO usa foto real") já documentava o comportamento PRETENDIDO desde
      // antes, mas o código nunca cumpriu — pessoa_conceito puxava a foto real do cliente sempre
      // que ela existia, exatamente o oposto do que o nome promete (pessoa GENÉRICA de IA). Nenhum
      // ponto do sistema depende do comportamento antigo: a persona da Estratégia (PERSONAS.
      // estrategia, "SEM foto pessoal... use pessoa_conceito") já instrui usá-lo como alternativa
      // SEM foto, nunca como sinônimo de 'pessoal' com foto; e o comentário logo abaixo já
      // declarava a intenção. Quem quiser a foto real escolhe 'pessoal' — sem campo novo. Efeito
      // colateral encontrado e NÃO corrigido aqui (fora do escopo pedido, arquivo diferente): o
      // teto de 40% do lote (agentes.html, `_querPessoa`) ainda conta 'pessoa_conceito' junto com
      // 'pessoal' para o mesmo teto — agora que pessoa_conceito nunca usa foto real, isso deixa o
      // teto mais apertado do que precisa para 'pessoal' (conta uma peça que nunca gastava foto
      // real contra a cota de quem gasta). Reportado ao cliente, decisão própria dele.
      if (tipo === 'pessoal' && primeiroSlide && !sem_foto_pessoa) {
        const fotos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.pessoais&select=url,created_at&order=created_at.desc&limit=8`, { headers: SBH() }).then(r => r.json());
        // PERMUTAÇÃO: alterna entre as fotos da pasta (nunca repete a mesma) — usa as mais recentes.
        if (Array.isArray(fotos) && fotos.length) {
          const esc = fotos[(Math.max(0, Number(slide || 1) - 1) + (uso.imagens || 0)) % fotos.length];
          const im = await baixarImg(esc.url); if (im) baseImgs.push({ ...im, tag: 'pessoa' });
        }
      }
      // TIPO 'produto' = FOTO REAL do produto (intocável). Só no 1º slide.
      if (tipo === 'produto' && primeiroSlide) {
        const prods = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.produtos&select=url,created_at&order=created_at.desc&limit=8`, { headers: SBH() }).then(r => r.json());
        // PRODUTO: usa as MAIS RECENTES da pasta, alternando entre elas a cada criativo.
        if (Array.isArray(prods) && prods.length) {
          const esc = prods[(uso.imagens || 0) % prods.length];
          const im = await baixarImg(esc.url); if (im) baseImgs.push({ ...im, tag: 'produto' });
        }
      }
      // TIPO 'pessoa_conceito' = pessoa GENÉRICA criada pela IA (família, dormindo, equipe) → NÃO usa foto real
      // (text-to-image livre) — SEMPRE agora, mesmo quando existe foto real do cliente (correção 20/set/2026 acima).
      // TIPO 'conceitual' = sem pessoa → também text-to-image livre.
      // (ambos caem no else de text-to-image; a logo ainda é aplicada se houver)
    } catch (e) { console.error('acervo:', e.message); }

    // chamarOpenAIImageToImage / chamarOpenAITextToImage (22/set/2026, "Engine 6.0 como caminho
    // padrão" Rodada 1, item 3, autorizado pelo João) — a chamada à OpenAI em si, fatorada para
    // fora de gerarPeca() em funções que remontam a requisição do zero a partir de primitivas já
    // conhecidas (baseImgs, size — ambos no escopo externo, não mudam entre chamadas). Existem
    // como função para permitir reenviarMesmoPrompt(): a verificação por visão (mais abaixo),
    // quando o texto diverge do esperado, regenera UMA VEZ com o MESMO texto de prompt — nunca
    // reaproveitando um FormData já consumido por um fetch anterior (não confiável), sempre
    // reconstruindo do zero com o texto idêntico capturado em promptFinal. Corpo da requisição
    // byte a byte o mesmo que sempre existiu — só reorganizado, nunca duplicado.
    async function chamarOpenAIImageToImage(promptTexto) {
      // MODELO POR CONFIGURAÇÃO (24/set/2026, "Trocar o motor de imagem...", decisão 4,
      // autorizado pelo João): era o literal 'gpt-image-1' — ver MODEL_IMAGEM_EDICAO, acima de
      // engine6(). Endpoint e quality confirmados idênticos entre gpt-image-1 e a linha GPT
      // Image 2/2.5 na doc oficial da OpenAI — input_fidelity, a doc TAMBÉM lista como suportado
      // por gpt-image-2, mas a API real recusou ("does not support the 'input_fidelity'
      // parameter") — a causa da rodada seguinte, "input_fidelity condicional e erro real
      // visível" (25/set/2026): ver `montarEChamar`/detecção por resposta, abaixo.
      const modelo = MODEL_IMAGEM_EDICAO();
      // MONTAR E CHAMAR (25/set/2026, "input_fidelity condicional e erro real visível", decisão
      // 1, autorizado pelo João) — fatorada pra poder repetir a MESMA chamada, byte a byte, só
      // tirando `input_fidelity` quando a OpenAI recusar apontando esse parâmetro. `comFidelity`
      // é o único grau de liberdade entre as duas montagens — nada mais muda entre tentativas.
      async function montarEChamar(comFidelity) {
        const form = new FormData();
        form.append('model', modelo);
        form.append('prompt', promptTexto);
        form.append('size', size);
        // QUALIDADE ALTA (22/set/2026, "Engine 6.0 como caminho padrão" Rodada 1, item 1,
        // autorizado pelo João): era 'medium' — a premissa registrada no diagnóstico ("a
        // fidelidade vem do rulebook, não da qualidade") nunca foi testada com o Diretor de Arte
        // funcionando (esteve quebrado ~2 meses até 18/09). O chat que o cliente usa como
        // referência roda em alta; o pipeline não tinha por que rodar abaixo disso.
        form.append('quality', 'high');
        // input_fidelity=high é o que REALMENTE preserva rosto/logo numa edição — quando o
        // modelo aceita o parâmetro. CONDICIONAL POR RESPOSTA (decisão 1): manda por padrão,
        // nunca decidido por lista de modelo (a lista envelhece a cada lançamento) — só sai
        // quando a 1ª tentativa já provou, pela própria resposta da OpenAI, que este modelo não
        // aceita. Sem isso, comportamento idêntico ao de sempre — gpt-image-1 nunca perde a
        // preservação de identidade que depende deste parâmetro (invariante da ordem).
        if (comFidelity) form.append('input_fidelity', 'high');
        // Ordem: referência principal (pessoa/produto) primeiro, logo por último
        const ordemImg = { pessoa: 0, produto: 1, logo: 2 };
        baseImgs.sort((a, b) => (ordemImg[a.tag] ?? 9) - (ordemImg[b.tag] ?? 9));
        for (const b of baseImgs) {
          form.append('image[]', new Blob([b.buf], { type: b.ct }), `${b.tag}.png`);
        }
        const _t0 = Date.now();
        const resp = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        });
        return { resp, tempoMs: Date.now() - _t0 };
      }
      let { resp, tempoMs } = await montarEChamar(true);
      let inputFidelityRemovido = false;
      if (!resp.ok) {
        // .clone() (nunca consome o corpo original): se NÃO for o caso de input_fidelity, `resp`
        // volta pro chamador intocado, pronto pra `await r.json()` normalmente — mesmo contrato
        // de sempre, só o corpo é espiado aqui, nunca gasto.
        let corpoErro = null;
        try { corpoErro = await resp.clone().json(); } catch (e) {}
        const msgErro = (corpoErro && corpoErro.error && corpoErro.error.message) || '';
        if (/input_fidelity/i.test(msgErro) && /does not support|not supported|unsupported|unknown parameter|unrecognized/i.test(msgErro)) {
          inputFidelityRemovido = true;
          console.error('[gerar-imagem] modelo ' + modelo + ' recusou input_fidelity — repetindo UMA vez sem o parâmetro:', msgErro);
          // UMA repetição, nunca um laço (invariante da ordem) — `resp`/`tempoMs` são
          // SUBSTITUÍDOS pela 2ª tentativa, nunca somados/escolhidos por comparação: esta
          // repetição corrige a MESMA chamada, não é uma segunda geração (não consome o
          // orçamento de UMA regeneração por defeito de imagem — esse é outro mecanismo,
          // verificarTextoPorVisao/reenviarMesmoPrompt, nunca tocado por este bloco).
          const segunda = await montarEChamar(false);
          resp = segunda.resp;
          tempoMs += segunda.tempoMs; // tempo total desta chamada, nunca esconde a 1ª tentativa
        }
      }
      // TEMPO REAL EM QUALIDADE ALTA (item 1, "medir e reportar"): não medível neste sandbox
      // (sem OPENAI_API_KEY) — instrumentado para a produção reportar o número real. Relevante
      // porque maxDuration é 300s e a regeneração dirigida pode exigir até duas gerações na
      // mesma requisição.
      console.log('[gerar-imagem] images/edits quality=high modelo=' + modelo + (inputFidelityRemovido ? ' (repetido sem input_fidelity)' : '') + ' levou', tempoMs, 'ms');
      // CUSTO E TEMPO (rodada anterior, "Alterações" item 4): usage anexado pelo CHAMADOR, depois
      // de consumir resp.json() — ver _chamadasOpenAI, acima de engine6(). input_fidelity_removido
      // (decisão 1 desta rodada, "registra no meta que a repetição aconteceu e por quê") fica
      // gravado no MESMO registro, sem campo paralelo.
      _chamadasOpenAI.push({ endpoint: 'images/edits', modelo, tempo_ms: tempoMs, ok: resp.ok, em: new Date().toISOString(), input_fidelity_removido: inputFidelityRemovido || undefined });
      return resp;
    }
    async function chamarOpenAITextToImage(promptTexto) {
      // MODELO POR CONFIGURAÇÃO (decisão 4): era o literal 'gpt-image-1' — ver MODEL_IMAGEM_TEXTO.
      const modelo = MODEL_IMAGEM_TEXTO();
      const _t0 = Date.now();
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, prompt: promptTexto, size, n: 1, quality: 'high' }),
      });
      const _tempoMs = Date.now() - _t0;
      console.log('[gerar-imagem] images/generations quality=high modelo=' + modelo + ' levou', _tempoMs, 'ms');
      _chamadasOpenAI.push({ endpoint: 'images/generations', modelo, tempo_ms: _tempoMs, ok: resp.ok, em: new Date().toISOString() });
      return resp;
    }

    // gerarPeca() — encapsula toda a lógica de montar o prompt (image-to-image OU text-to-image,
    // conforme haja foto/produto real) e chamar a OpenAI. Existe como função (22/set/2026,
    // "composição — Fase 1", autorizado pelo João) para poder ser chamada DUAS VEZES na mesma
    // requisição: uma vez com composição desejada, e — só se o compositor falhar depois de já
    // ter uma imagem em mãos — uma segunda vez com composicaoDesejada=false, pelo caminho
    // TRADICIONAL de sempre (texto renderizado pelo próprio modelo). Isso existe porque, com
    // composição ativa, o próprio prompt manda o modelo NÃO renderizar texto nenhum — se o
    // compositor falhar depois disso, a única imagem em mãos está muda; a única forma de nunca
    // entregar uma arte quebrada (portão pedido pelo João) é regenerar do zero pelo caminho que
    // sempre funcionou. Chamada com composicaoDesejada=false, o corpo é BYTE A BYTE o mesmo texto
    // que sempre existiu neste arquivo — só reorganizado dentro de uma função, nunca duplicado.
    // RETORNO ESTENDIDO (item 3 e item 4, 22/set/2026): promptFinal é o texto EXATO mandado ao
    // gpt-image-1 (persistido em conteudos.meta.prompt_final, item 4); reenviarMesmoPrompt()
    // chama a MESMA rota (edits ou generations, conforme o caminho já decidido) de novo, com o
    // MESMO texto — usado pela verificação por visão (item 3) quando o texto sai divergente.
    async function gerarPeca(composicaoDesejada) {
      let localR;
      let compAtivaLocal = false;
      let localMaterialRealPreservado = false;
      let promptFinalLocal = '';
      // CENA COM MEMÓRIA (24/set/2026, decisão 3): captura o resumo de UMA linha que o Diretor
      // devolveu junto com o prompt (ver diretorDeArte, "SCENE MEMORY") — vazio quando engine:false
      // (sem Diretor) ou quando o modelo não seguiu o formato pedido (degrada, nunca quebra).
      let localResumoCena = '';
      // INSTRUMENTO PERMANENTE — PROMPT/RESPOSTA DO DIRETOR (24/set/2026, decisão 1 desta ordem):
      // mesmo padrão de localResumoCena acima — nulo/vazio quando engine:false (sem Diretor) ou
      // quando diretorDeArte() falhou/degradou (nunca quebra a geração por causa disto).
      let localDiretorPrompt = null;
      let localDiretorResposta = '';
    if (baseImgs.length) {
      // image-to-image: usa foto/logo reais como base (preserva identidade + logo verdadeira)
      const temPessoa = baseImgs.some(b => b.tag === 'pessoa');
      const temProduto = baseImgs.some(b => b.tag === 'produto');
      // COMPOSIÇÃO (22/set/2026): só se aplica quando o modo resolvido é EDITORIAL — a única
      // arquitetura que esta fase compõe (CENA fica para a Fase 2, ver _composicao-lib.js).
      // Mesma função escolherModo que diretorDeArte usará mais abaixo com os MESMOS argumentos —
      // determinístico, não pode divergir.
      compAtivaLocal = composicaoDesejada && escolherModo({ modo, tipo }, { temProduto, variacao: Number(variacao) || 0 }) === 'editorial';
      // ── CONTRATO DE PRESERVAÇÃO ────────────────────────────────────────────────
      // REGRESSÃO QUE EU CRIEI NO PACOTE DO DIRETOR: o `preserva` era colado só NO FIM,
      // depois de ~400 palavras mandando "the ENTIRE canvas is ONE PHOTOGRAPH of a real
      // place, build the SET". Re-fotografar o lugar = re-fotografar quem está nele. A trava
      // não enfraqueceu — a instrução contrária ficou 10x mais forte. (Com `medium` +
      // input_fidelity=high a foto era preservada 100% ANTES da doutrina CENA. Não é qualidade.)
      // 3 correções, custo zero:
      //  1. MOLDURA: o contrato ABRE e FECHA o prompt. Chegar no rodapé é chegar tarde.
      //  2. DUAS COLUNAS: "preserve tudo" contra "construa cena nova" é contradição — o modelo
      //     resolve mexendo no sujeito. Dizer o que PODE mudar dá vazão legal à ordem de mudar.
      //  3. LISTA ENUMERADA: vago o modelo negocia, enumerado ele obedece (foi o que fez o
      //     acento parar de alucinar: "Text to render" + character-for-character).
      // CAUSA RAIZ MAIS FUNDA (21/set/2026, "supressão no modo editorial", decisão caminho 3,
      // autorizado pelo João contra o "não alterar" — "o não alterar protegia o contrato por
      // funcionar; aqui ele é a origem do defeito"): LIBERADOS listava clothing/pose/body
      // position/framing and crop/lighting/shadows/colour grade — cada um é uma licença para
      // redesenhar o SUJEITO. Mudar a pose exige redesenhar o corpo; reiluminar exige repintar o
      // sombreamento do rosto. O contrato que deveria preservar era o que autorizava a
      // distorção — explica a distorção de rosto melhor que qualquer ajuste de doutrina anterior.
      // Correção: separar o que é do SUJEITO (travado, sempre) do que é do AMBIENTE (liberado).
      // Roupa, pose, posição do corpo, luz/sombra/cor SOBRE o sujeito e qualquer corte que remova
      // parte dele saem de LIBERADOS e entram em travados — aplicado igualmente a pessoa e
      // produto. O enquadramento do canvas continua livre, mas condicionado: só enquanto o
      // sujeito permanecer inteiro dentro dele (nunca cortado).
      const travados = [];
      if (temPessoa) travados.push('face shape and geometry', 'jawline', 'nose', 'eyes and eyebrows', 'lips', 'skin texture, marks, freckles, moles, wrinkles', 'hairline and haircut', 'beard', 'tattoos (exact artwork, placement and scale)', 'necklace, watch, rings, glasses, piercings and every accessory worn', 'body proportions', 'apparent age', 'clothing', 'pose and body position', 'the lighting and shadow falling on the person — face and body keep exactly the light they already have in the photo', 'colour grade and tone applied to the person', 'any crop or framing that cuts off any part of the person');
      if (temProduto) travados.push('product silhouette and proportions', 'exact colours', 'label artwork and the typography printed on it', 'surface texture and material', 'filling, topping, coating and internal detail', 'finish and gloss', 'the exact count/quantity of items shown', "the product's position and orientation", 'the lighting and shadow falling on the product — it keeps exactly the light it already has in the photo', 'colour grade and tone applied to the product', 'any crop or framing that cuts off any part of the product');
      const LIBERADOS = 'background, environment and set, the surface the subject or product rests on, ambient light and shadow in the ENVIRONMENT around the subject (never on the subject or product itself), film grain and texture applied to the environment, and the canvas framing — you may reposition or reframe the canvas as long as the subject or product stays entirely inside it, never cropped or cut off';

      const cabecalho = travados.length
        ? '=== PRESERVATION CONTRACT — READ BEFORE ANYTHING ELSE (OUTRANKS EVERY OTHER INSTRUCTION BELOW) ==='
          + ' The attached photo is REAL and it is the source of truth. The subject in it is NOT re-photographed, NOT re-rendered and NOT re-lit: it is transplanted into the scene exactly as it already looks and is already lit in the original photo.'
          + ' Everything locked below belongs to the subject itself. Everything free belongs to the world around it — the photo never bends to serve the scene, the scene bends to serve the photo.'
          + ' YOU MAY freely change: ' + LIBERADOS + '.'
          + ' CRITICAL: preserving the subject does NOT mean a plain or minimalist background. Build the SAME rich, cinematic, textured environment you would build WITHOUT an attached photo — real set, practical light, depth, atmosphere. A locked subject on a bare flat background is a FAILURE. Freeze the person/product exactly as lit; go full-force on the world around them.'
          + ' YOU MAY NOT change anything about the subject itself, including how it is lit. If any instruction below conflicts with this contract, this contract wins and that instruction is discarded.'
          + ' This is a PHOTOREALISTIC photograph — never an illustration, cartoon, vector, drawing or CGI render. ===\n\n'
        : '';

      let preserva = '\n\n=== PRESERVATION CONTRACT — FINAL CHECK (ABSOLUTE PRIORITY OVER STYLE) ===';
      if (temPessoa) {
        preserva += ' The person in the attached photo is the absolute identity source: the exact same individual, as if photographed again on another day. No lookalike, no "inspired by", no sibling. Do NOT beautify, smooth, slim, rejuvenate, retouch or stylise. Reject plastic or waxy skin, CGI look, uncanny valley, distorted hands or face.';
      }
      if (temProduto) {
        preserva += ' The product in the attached photo is the absolute source of truth: it is a REAL product a real customer will receive. Do NOT redesign, recolour, improve, beautify, restyle or invent variations of it. An altered product turns this piece into false advertising.';
      }
      if (travados.length) {
        preserva += ' PRESERVE EXACTLY, item by item — copy each one pixel-faithfully from the attached photo, changing NOTHING:\n'
          + travados.map(t => '- ' + t).join('\n')
          + '\nGo through that list one item at a time and confirm each is identical to the attached photo. Anything NOT on that list may change freely: ' + LIBERADOS + '.';
      }
      preserva += ' Do NOT add, draw, invent or duplicate any logo, symbol, emblem, monogram, watermark or extra brand signature anywhere in the image — the real brand mark is applied later by the system. ===';

      // engine:false → peça que NÃO é post de Instagram (ex.: ficha técnica da marca).
      // materialReal (21/set/2026): sinal novo pra engine6 condicionar a seção 6 (luz
      // direcional/sombra) ao ambiente quando há pessoa ou produto real preservado.
      // ctaSeloPorCodigo (24/set/2026, decisão 4; revertida por padrão em 25/set/2026, "Devolver
      // CTA e selo ao modelo...", decisão 1) — true só quando a CHAVE ÚNICA CTA_SELO_POR_CODIGO
      // (acima) está ligada E este é o caminho TRADICIONAL (compAtivaLocal false); nunca os dois
      // caminhos (tradicional por código, composição completa) ao mesmo tempo — invariante de
      // sempre. Com a chave desligada (padrão atual), byte a byte o mesmo de antes da Rodada de
      // 24/set: CTA e selo voltam a ser pedidos ao modelo.
      const oArte = { tema: prompt, headline, subheadline, prova, cta_arte, copy, oferta, formato, pilar, slide, total, tipo, canvas, modo, materialReal: temPessoa || temProduto, composicaoAtiva: compAtivaLocal, ctaSeloPorCodigo: CTA_SELO_POR_CODIGO && !compAtivaLocal, alvoRecorte: _alvoRecorte, regiaoEntregue: _regiaoEntregue, zonasPills: _zonasPillsGeradas };
      const dirTxt = (engine === false) ? null : await diretorDeArte(M6, oArte, { temFoto: temPessoa, temProduto, variacao: Number(variacao) || 0, ajuste, permitirInvencaoHeadline: !!permitir_invencao_headline, cenasRecentes: _cenasRecentes });
      // MOLDURA: contrato → cena → contrato. Nunca só no rodapé.
      const instr = cabecalho + (engine === false ? prompt
        : (engine6(M6, oArte)
           + (dirTxt ? '\n\n=== ART DIRECTION FOR THIS PIECE (concrete scene — obey every rule above while rendering it) ===\n' + dirTxt.texto : '')))
        + preserva;
      promptFinalLocal = instr;
      localR = await chamarOpenAIImageToImage(instr);
      // COMPOSIÇÃO (achado 3, correção): compor() precisa saber se há material real preservado
      // nesta peça (pessoa ou produto) pra encolher a distância da fusão (8% em vez de 22%) — a
      // foto por baixo pode ser o próprio sujeito travado pelo contrato de preservação.
      localMaterialRealPreservado = temPessoa || temProduto;
      localResumoCena = (dirTxt && dirTxt.resumoCena) || '';
      localDiretorPrompt = (dirTxt && dirTxt.promptSistema) ? { sistema: dirTxt.promptSistema, usuario: dirTxt.promptUsuario } : null;
      localDiretorResposta = (dirTxt && dirTxt.respostaBruta) || '';
    } else {
      // text-to-image: pessoa_conceito pode criar gente genérica; conceitual sem pessoa
      // COMPOSIÇÃO (22/set/2026): temProduto é sempre false neste ramo (baseImgs vazio) — mesma
      // função escolherModo, mesmos argumentos que diretorDeArte usará mais abaixo.
      compAtivaLocal = composicaoDesejada && escolherModo({ modo, tipo }, { temProduto: false, variacao: Number(variacao) || 0 }) === 'editorial';
      let extra = ' IMPORTANT: do NOT create, draw, write, duplicate or invent any logo, brand name, signature or handwriting in the image — leave brand space clean (the real logo is added separately). All text spelling 100% correct in Portuguese (ç ã õ é á), perfect kerning, no melted/fused letters.';
      if (tipo === 'pessoa_conceito') {
        // Só cai aqui se o cliente NÃO tem foto na pasta (senão usa a real, acima).
        extra += ' Includes a realistic generic person/people (not a specific real individual), photorealistic, never illustration or cartoon.';
      } else if (tipo === 'conceitual') {
        extra += ' NO people — use objects, mockups, screenshots, graphics or abstract elements.';
      }
      // ctaSeloPorCodigo (25/set/2026): mesmo raciocínio do ramo image-to-image, acima — gated
      // pela mesma chave única CTA_SELO_POR_CODIGO.
      const oArte2 = { tema: prompt, headline, subheadline, prova, cta_arte, copy, oferta, formato, pilar, slide, total, tipo, canvas, modo, materialReal: false, composicaoAtiva: compAtivaLocal, ctaSeloPorCodigo: CTA_SELO_POR_CODIGO && !compAtivaLocal, alvoRecorte: _alvoRecorte, regiaoEntregue: _regiaoEntregue, zonasPills: _zonasPillsGeradas };
      const dirTxt2 = (engine === false) ? null : await diretorDeArte(M6, oArte2, { temFoto: false, temProduto: false, variacao: Number(variacao) || 0, ajuste, permitirInvencaoHeadline: !!permitir_invencao_headline, cenasRecentes: _cenasRecentes });
      const promptSemLogo = (engine === false ? prompt
        : (engine6(M6, oArte2)
           + (dirTxt2 ? '\n\n=== ART DIRECTION FOR THIS PIECE (concrete scene — obey every rule above while rendering it) ===\n' + dirTxt2.texto : '')))
        + (compAtivaLocal ? '' : extra);
      promptFinalLocal = promptSemLogo;
      localR = await chamarOpenAITextToImage(promptSemLogo);
      localResumoCena = (dirTxt2 && dirTxt2.resumoCena) || '';
      localDiretorPrompt = (dirTxt2 && dirTxt2.promptSistema) ? { sistema: dirTxt2.promptSistema, usuario: dirTxt2.promptUsuario } : null;
      localDiretorResposta = (dirTxt2 && dirTxt2.respostaBruta) || '';
    }
      // reenviarMesmoPrompt (item 3, rodada anterior; adendoCorretivo, decisão 1 desta rodada):
      // chama de novo a MESMA rota, com o MESMO texto de prompt já capturado — nunca reconstrói o
      // prompt (o Diretor não é chamado de novo, a cena não muda) — mas agora aceita um adendo
      // OPCIONAL (montado pelo ponto de chamada, a partir de divergentes+faixaDescartada da 1ª
      // tentativa), anexado ao FIM do texto já existente. Sem adendo (nenhum argumento), o
      // comportamento é byte a byte o mesmo de antes — reenvio cego, nunca o padrão agora.
      const reenviarMesmoPrompt = (adendoCorretivo) => baseImgs.length
        ? chamarOpenAIImageToImage(promptFinalLocal + (adendoCorretivo || ''))
        : chamarOpenAITextToImage(promptFinalLocal + (adendoCorretivo || ''));
      return { r: localR, composicaoAtivaEfetiva: compAtivaLocal, materialRealPreservado: localMaterialRealPreservado, promptFinal: promptFinalLocal, reenviarMesmoPrompt, resumoCena: localResumoCena, diretorPrompt: localDiretorPrompt, diretorResposta: localDiretorResposta };
    }
    let { r, composicaoAtivaEfetiva, materialRealPreservado, promptFinal, reenviarMesmoPrompt, resumoCena, diretorPrompt, diretorResposta } = await gerarPeca(composicaoLigada && engine !== false);
    const result = await r.json();
    // CUSTO E TEMPO (rodada anterior, "Alterações" item 4, autorizado pelo João): usage só é
    // conhecido aqui, depois de consumir o corpo da resposta — anexado ao último item de
    // _chamadasOpenAI (a chamada que acabou de terminar; execução sequencial, ver comentário na
    // declaração do array). Ausente na resposta (doc marca usage como "For gpt-image-1 only" —
    // ver relatório) → fica undefined, nunca inventado.
    if (_chamadasOpenAI.length) _chamadasOpenAI[_chamadasOpenAI.length - 1].usage = result.usage || undefined;
    // MODELO REALMENTE USADO NESTA CHAMADA (25/set/2026, "input_fidelity condicional e erro real
    // visível", decisão 4, autorizado pelo João) — antes as mensagens amigáveis abaixo citavam
    // 'gpt-image-1' escrito à mão, mesmo quando a chamada de verdade usou outro modelo (via
    // MODEL_IMAGEM_EDICAO()/MODEL_IMAGEM_TEXTO(), rodada anterior) — lido do MESMO registro que
    // já existe em _chamadasOpenAI, nunca uma segunda fonte.
    const _modeloUsado = (_chamadasOpenAI.length && _chamadasOpenAI[_chamadasOpenAI.length - 1].modelo) || 'gpt-image-1';
    if (!r.ok) {
      const detalhe = (result.error && result.error.message) || JSON.stringify(result).slice(0, 200);
      console.error('openai gpt-image:', detalhe);
      // Sem valor inicial fixo (decisão 4: nenhum erro deveria cair num genérico que some com a
      // causa) — o `else` final, no fim da cadeia, é o único fallback, e mostra o texto real.
      let amigavel;
      if (/billing|quota|insufficient/i.test(detalhe)) amigavel = 'Sem créditos na OpenAI. Adicione em platform.openai.com → Billing.';
      else if (/content_policy|safety|moderation/i.test(detalhe)) amigavel = 'O conteúdo do prompt foi recusado pela OpenAI. Ajuste a descrição e tente de novo.';
      // INPUT_FIDELITY (decisão 1 e 4): chega aqui só se a repetição automática (dentro de
      // chamarOpenAIImageToImage, acima) também tiver falhado, ou por outro parâmetro fora dela
      // — caso raro, mas com regra própria pra nunca cair no genérico "modelo indisponível" logo
      // abaixo (a causa real dos dois dias de diagnóstico errado desta ordem).
      else if (/input_fidelity/i.test(detalhe)) amigavel = 'O modelo ' + _modeloUsado + ' recusou o parâmetro input_fidelity mesmo depois da repetição automática sem ele — falha diferente na 2ª tentativa. Veja o texto real da OpenAI abaixo.';
      else if (/size|dimension/i.test(detalhe)) amigavel = 'Formato de imagem inválido. Tente outro tamanho.';
      else if (/api key|invalid|authentication/i.test(detalhe)) amigavel = 'Chave da OpenAI inválida. Verifique a OPENAI_API_KEY na Vercel.';
      else if (/verif|organization|access|must be verified/i.test(detalhe)) amigavel = 'Sua organização OpenAI precisa ser verificada para usar o ' + _modeloUsado + '. Acesse platform.openai.com → Settings → Organization → Verify.';
      // MODELO INEXISTENTE/SEM ACESSO (decisão 4, autorizado pelo João) — era `/does not exist|model/i`,
      // larga demais: QUALQUER erro que citasse a palavra "model" caía aqui, inclusive "The model
      // 'gpt-image-2' does not support the 'input_fidelity' parameter" (contém "model", não é falta
      // de acesso nenhuma) — a causa real dos dois dias de diagnóstico errado desta ordem. Agora
      // exige a FRASE que de fato indica modelo inexistente/sem acesso, não a palavra solta.
      else if (/model[\s\S]{0,60}(does not exist|not found|is not available)|do(es)? not have access to (the )?model/i.test(detalhe)) amigavel = 'Modelo de imagem (' + _modeloUsado + ') indisponível na sua conta. Verifique o acesso a esse modelo em platform.openai.com.';
      // QUALQUER ERRO NÃO RECONHECIDO (decisão 4): antes caía no genérico "Falha ao gerar imagem.
      // Tente novamente" — mensagem que esconde a causa. Agora, sem casar com nenhuma regra
      // conhecida, devolve o texto da OpenAI como está (dentro do limite de tamanho do campo
      // `amigavel` mesmo, truncado só por sanidade de exibição — `detalhe`, abaixo, já carrega o
      // texto completo até 300 caracteres de qualquer forma).
      else amigavel = 'A OpenAI recusou a geração: ' + detalhe.slice(0, 200);
      // ERRO REAL SEMPRE VISÍVEL (decisão 3, autorizado pelo João): `detalhe` nunca mais é
      // substituído pela frase amigável — as duas viajam juntas na mesma resposta. Era 160
      // caracteres; 300 dá espaço pra mensagens de erro mais longas da OpenAI sem cortar a parte
      // que de fato diagnostica (ex.: a lista de parâmetros aceitos que alguns erros incluem).
      return res.status(500).json({ error: amigavel, detalhe: detalhe.slice(0, 300) });
    }
    // gpt-image-1 retorna base64 diretamente
    let b64 = result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) return res.status(500).json({ error: 'Resposta sem imagem' });
    let bytes = Buffer.from(b64, 'base64');

    // COMPOSIÇÃO (22/set/2026, Fase 1, autorizado pelo João) — texto e logo reais compostos por
    // código (sharp + opentype.js, ver _composicao-lib.js), no lugar do que o modelo renderizaria.
    // Só roda quando composicaoAtivaEfetiva (interruptor da conta ligado E modo resolvido
    // EDITORIAL) — para qualquer outro cliente/peça este bloco inteiro não executa, caminho
    // sem composição continua byte a byte igual. PORTÃO (pedido explícito do João): "se o
    // compositor falhar, nunca entregar a imagem do modelo sem texto — cair para o caminho
    // atual". Como o próprio prompt, quando composição está ativa, já manda o modelo NÃO
    // renderizar texto nenhum, "o caminho atual" só pode significar regenerar do zero pelo
    // caminho tradicional (texto renderizado pelo modelo) — entregar a imagem muda que já está
    // em mãos violaria a MESMA frase que pede o fallback. gerarPeca(false) reconstrói o prompt
    // tradicional e chama a OpenAI de novo; falhando essa segunda chamada também, devolve erro —
    // nunca uma arte quebrada.
    let logoJaComposta = false;
    if (composicaoAtivaEfetiva) {
      let compositorFalhou = false;
      try {
        let logoBuffer = null;
        try {
          const logos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.logo&select=url,created_at&order=created_at.desc&limit=1`, { headers: SBH() }).then(r2 => r2.json());
          const logoUrl = Array.isArray(logos) && logos[0] && logos[0].url;
          if (logoUrl) { const im = await baixarImg(logoUrl); if (im) logoBuffer = im.buf; }
        } catch (e) { /* sem logo cadastrado → peça sai sem logo, nunca trava a entrega (PARTE 3) */ }
        const conteudoComp = { headline, subheadline, pilar, prova, cta: cta_arte };
        const out = await compor({ imagemBase: bytes, vertical: _vertical, M: M6, conteudo: conteudoComp, userId: targetId, logoBuffer, materialRealPreservado });
        bytes = out.buffer;
        logoJaComposta = true;
        (out.logs || []).forEach(l => console.log(l));
      } catch (e) {
        compositorFalhou = true;
        console.error('[composicao] compositor falhou, regenerando pelo caminho tradicional:', e.message);
      }
      if (compositorFalhou) {
        const retry = await gerarPeca(false);
        r = retry.r;
        // SCENE MEMORY (24/set/2026, decisão 3): a regeneração de segurança chama o Diretor de
        // novo (nova cena, prompt tradicional) — o resumo da 1ª chamada não vale mais pra esta
        // peça; troca pelo resumo da regeneração, mesmo se vazio (nunca fica com o resumo velho).
        resumoCena = retry.resumoCena || '';
        // INSTRUMENTO PERMANENTE (decisão 1, mesma cautela): idem — o prompt/resposta do Diretor
        // da 1ª chamada não descreve mais a peça que de fato sai daqui (esta é a regeneração pelo
        // caminho tradicional); troca pelos da regeneração, mesmo se vazios.
        diretorPrompt = retry.diretorPrompt || null;
        diretorResposta = retry.diretorResposta || '';
        const result2 = await r.json();
        // CUSTO E TEMPO: mesma anexação de usage, agora pra chamada de regeneração de fallback
        // (compositor falhou → gerarPeca(false), caminho tradicional).
        if (_chamadasOpenAI.length) _chamadasOpenAI[_chamadasOpenAI.length - 1].usage = result2.usage || undefined;
        if (!r.ok || !(result2.data && result2.data[0] && result2.data[0].b64_json)) {
          const detalhe2 = (result2.error && result2.error.message) || 'regeneração sem composição também falhou';
          console.error('[composicao] regeneração de fallback falhou:', detalhe2);
          if (conteudo_id) await registrarFalhaComposicaoNaOrdem(conteudo_id, `Compositor falhou e a regeneração de segurança também falhou: ${detalhe2}`);
          return res.status(500).json({ error: 'Falha ao gerar imagem (composição e regeneração de segurança falharam). Tente novamente.', detalhe: String(detalhe2).slice(0, 160) });
        }
        b64 = result2.data[0].b64_json;
        bytes = Buffer.from(b64, 'base64');
        // segue para o crop tradicional abaixo — esta peça saiu pelo caminho sem composição.
        // PARTE 4, 2ª condição do João (confirmada, 22/set/2026): "registro visível na ordem, com
        // o motivo" — não bastava o console.error acima (só visível a quem olha log da Vercel).
        // Grava em conteudos.meta.composicao_falha (mesmo padrão read-merge-write de gravarSlide,
        // acima — PATCH em jsonb substitui o objeto inteiro, nunca escrever sem mesclar primeiro).
        // Só quando há um conteúdo real por trás (conteudo_id) — preview avulso não tem ordem.
        if (conteudo_id) await registrarFalhaComposicaoNaOrdem(conteudo_id, `Compositor falhou nesta peça — regenerada pelo caminho tradicional (texto renderizado pelo modelo, sem composição por código).`);
      }
    }

    // VERIFICAÇÃO DE TEXTO POR VISÃO (22/set/2026, "Engine 6.0 como caminho padrão" Rodada 1,
    // item 3, autorizado pelo João) — "depois de gerar, antes do corte e do upload": roda aqui,
    // nos bytes CRUS da OpenAI (PNG, ainda sem crop), porque cortar não muda a letra que o
    // modelo já renderizou — só a moldura ao redor — e verificar antes evita gastar o corte numa
    // imagem que a regeneração pode substituir.
    // GATE: só quando há texto do modelo pra conferir — engine!==false (não é ficha técnica) E
    // caminho PADRÃO sem composição (composição, quando ativa, já manda o modelo NÃO renderizar
    // texto nenhum — nada a verificar) E pelo menos um dos campos esperados não está vazio.
    // CTA E SELO POR CÓDIGO (24/set/2026, decisão 4, autorizado pelo João): selo e cta saem daqui
    // — depois desta rodada, NENHUM caminho pede mais ao modelo pra desenhá-los (composição, já
    // suprimia; tradicional, agora também suprime via o.ctaSeloPorCodigo em engine6). Verificar
    // por visão um campo que nunca foi pedido ao modelo não é verificação, é ruído — e os dois
    // são compostos DEPOIS do corte, em pixel exato, sem margem pra "divergir" do esperado.
    const textoEsperado = { selo: '', headline: headline || '', subheadline: subheadline || '', prova: prova || '', cta: '' };
    const _temTextoParaVerificar = engine !== false && !composicaoAtivaEfetiva && Object.values(textoEsperado).some(v => String(v || '').trim());
    let verificacaoTexto = null;
    if (_temTextoParaVerificar) {
      try {
        const v1 = await verificarTextoPorVisao(bytes, textoEsperado, 'image/png', _regiaoEntregue);
        const divergentes1 = compararTextoLido(textoEsperado, v1.lidos);
        // 23/set/2026 ("Corte, mockup e teto de texto", decisão 1, autorizado pelo João): elemento
        // em faixa descartada agora conta como divergência, no MESMO fluxo de regeneração de uma
        // tentativa que já existia pra texto errado — a seção 12 sozinha (prosa) não bastou pra
        // impedir o label do topo e o CTA da base cortados na peça de teste.
        const faixaDescartada1 = { em: !!(v1.lidos && v1.lidos.elemento_em_faixa_descartada), descricao: String((v1.lidos && v1.lidos.descricao_faixa_descartada) || '') };
        if (!divergentes1.length && !faixaDescartada1.em) {
          verificacaoTexto = { modelo: v1.modelo, esperado: textoEsperado, lido: v1.lidos, divergentes: [], faixa_descartada: faixaDescartada1, tentativas: 1 };
        } else {
          // REGENERAÇÃO DIRIGIDA (24/set/2026, "Regeneração dirigida, defeito visível e cena que
          // não se repete", decisão 1, autorizado pelo João): a peça de 24/set provou que
          // reenviarMesmoPrompt() sem informação nenhuma não corrige nada — tentativas=2 e os
          // mesmos 2 erros de texto + o mesmo CTA cortado continuaram na peça entregue. Agora
          // monta um adendo curto a partir do que a 1ª tentativa já sabe (divergentes1 +
          // faixaDescartada1) e anexa ao MESMO prompt — a cena continua não mudando (o Diretor não
          // é chamado de novo), só ganha uma correção dirigida do que saiu errado. Orçamento
          // continua em UMA regeneração (invariante do João) — o adendo não abre uma 3ª tentativa.
          if (divergentes1.length) console.error('[verificacao-texto] divergiu na 1ª tentativa:', JSON.stringify(divergentes1));
          if (faixaDescartada1.em) console.error('[verificacao-texto] elemento em faixa descartada na 1ª tentativa:', faixaDescartada1.descricao);
          const _adendoCorretivo = montarAdendoCorretivo(divergentes1, faixaDescartada1);
          const retryResp = await reenviarMesmoPrompt(_adendoCorretivo);
          const retryResult = await retryResp.json().catch(() => null);
          // CUSTO E TEMPO: mesma anexação de usage do ponto acima, agora pra chamada de retry.
          if (_chamadasOpenAI.length) _chamadasOpenAI[_chamadasOpenAI.length - 1].usage = (retryResult && retryResult.usage) || undefined;
          const retryB64 = retryResult && retryResult.data && retryResult.data[0] && retryResult.data[0].b64_json;
          if (retryResp.ok && retryB64) {
            const bytesRetry = Buffer.from(retryB64, 'base64');
            const v2 = await verificarTextoPorVisao(bytesRetry, textoEsperado, 'image/png', _regiaoEntregue);
            const divergentes2 = compararTextoLido(textoEsperado, v2.lidos);
            const faixaDescartada2 = { em: !!(v2.lidos && v2.lidos.elemento_em_faixa_descartada), descricao: String((v2.lidos && v2.lidos.descricao_faixa_descartada) || '') };
            // DIVERGE NAS DUAS: fica com a tentativa de MENOS divergências (empate → fica com a
            // 2ª, é a que já passou por uma tentativa de correção). Elemento em faixa descartada
            // entra no mesmo placar, como +1 problema — texto certo com CTA cortado ainda é pior
            // que texto certo sem nada cortado.
            const placar1 = divergentes1.length + (faixaDescartada1.em ? 1 : 0);
            const placar2 = divergentes2.length + (faixaDescartada2.em ? 1 : 0);
            if (placar2 <= placar1) {
              bytes = bytesRetry;
              verificacaoTexto = { modelo: v2.modelo, esperado: textoEsperado, lido: v2.lidos, divergentes: divergentes2, faixa_descartada: faixaDescartada2, tentativas: 2 };
            } else {
              verificacaoTexto = { modelo: v1.modelo, esperado: textoEsperado, lido: v1.lidos, divergentes: divergentes1, faixa_descartada: faixaDescartada1, tentativas: 2 };
            }
          } else {
            // regeneração de correção falhou (infra) — fica com a única imagem válida em mãos.
            console.error('[verificacao-texto] regeneração de correção falhou, mantendo a 1ª tentativa');
            verificacaoTexto = { modelo: v1.modelo, esperado: textoEsperado, lido: v1.lidos, divergentes: divergentes1, faixa_descartada: faixaDescartada1, tentativas: 1, regeneracao_falhou: true };
          }
        }
      } catch (e) {
        // FALHA DE INFRAESTRUTURA (rede, sem ANTHROPIC_API_KEY, tool_choice sem retorno) — NUNCA
        // trata como divergência, NUNCA regenera às cegas (distinção pedida pelo João). Segue com
        // a imagem que já está em mãos, sem registro de verificação nesta peça.
        console.error('[verificacao-texto] falha de infraestrutura, seguindo sem verificar:', e.message);
      }
    }

    // LOGO REAL NO CANTO — CAMINHO PADRÃO (22/set/2026, "Engine 6.0 como caminho padrão" Rodada
    // 1, item 2, autorizado pelo João): desacoplado do interruptor de composição — roda para
    // TODO fluxo (chat avulso, ordem de serviço, worker do cron, ordem do Tráfego), não só
    // quando agentes.html está aberto no navegador. O Engine já previa o canto calmo (18% da
    // largura, ver o texto do próprio Engine mais acima) para o sistema colar a logo real
    // DEPOIS — isso nunca tinha sido cumprido fora do navegador (worker e aprovar.html sempre
    // entregaram sem logo). Roda DEPOIS do crop (precisa das dimensões finais do template para
    // posicionar certo) e só quando ninguém já colou a logo antes (!logoJaComposta cobre tanto o
    // caminho comum quanto o fallback do compositor, que também sai sem logo colada). Sem logo
    // cadastrada (categoria='logo'), a peça sai sem — nunca trava a entrega, mesmo princípio do
    // compositor de texto (PARTE 3, acima).
    if (!logoJaComposta) try {
      const sharp = require('sharp');
      const _vert = (typeof _vertical !== 'undefined') ? _vertical : false;
      // FONTE ÚNICA (Causa 1, Rodada 2, 22/set/2026, autorizado pelo João): _alvoRecorte já foi
      // calculado uma única vez onde size/canvas nascem (acima) — exatamente o par que o prompt
      // declarou ao modelo em engine6 seção 12. O fallback ao literal antigo só existe por
      // defensividade de escopo (mesmo padrão já usado para _vert acima), nunca deveria disparar.
      const alvo = (typeof _alvoRecorte !== 'undefined' && _alvoRecorte) ? _alvoRecorte : (_vert ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 });
      // position:'center' (Causa 1 — era 'attention'): saliência escolhia o corte por heurística
      // de conteúdo, DIFERENTE a cada peça gerada — o prompt agora promete ao modelo qual região
      // central sobrevive (DELIVERED REGION, seção 12), então o corte real tem que ser
      // DETERMINÍSTICO pra bater com o que foi prometido. Com 'attention', a região que sobrevive
      // podia não ser a central que o prompt declarou, e a composição saía imprevisível — a causa
      // exata do botão cortado e do elemento decepado que o João relatou.
      bytes = await sharp(bytes).resize(alvo.w, alvo.h, { fit: 'cover', position: 'center' }).jpeg({ quality: 88, chromaSubsampling: '4:2:0' }).toBuffer();
      // CTA E SELO POR CÓDIGO (24/set/2026, "Foto travada de verdade, CTA e selo por código, e
      // enxergar o Diretor", decisão 4, autorizado pelo João) — "três tentativas, três falhas"
      // pedindo ao modelo pra reposicionar o CTA (Achado 2 da ordem: o gerador entrega 2:3, o
      // Instagram aceita 4:5, a diferença sai das bordas, onde CTA e selo caem). engine6() já
      // parou de pedir ao modelo pra desenhar os dois (ver o.ctaSeloPorCodigo, acima) — aqui,
      // DEPOIS do corte determinístico (bytes já é 1080×1350/1080×1920) e ANTES do upload, código
      // compõe as duas pílulas em pixel exato, dentro da margem segura do MESMO template que o
      // logo (abaixo) já usa. CAMINHO ESTREITO (pedido explícito do João): reaproveita
      // carregarFonteParaTexto/pilulaSvg/escolherCorTexto de _composicao-lib.js — nunca invoca
      // compor() (o template de composição completo, que segue desligado fora do modo EDITORIAL
      // com composição ativa). NUNCA roda quando compor() já compôs tudo (este bloco inteiro está
      // dentro do `if (!logoJaComposta)` — logoJaComposta só vira true quando compor() já colou
      // CTA+selo+headline+tudo por código; os dois caminhos nunca coexistem, invariante da ordem).
      // engine!==false (ficha técnica não carrega pilar/cta_arte de peça — mesmo escopo de
      // validarTextoDaPeca). SELO cai no mesmo fallback que engine6() já usava pro LABEL (pilar,
      // senão a marca) — sem o passo final de "derivar uma palavra do tema", que exige raciocínio
      // que só o modelo tinha; se pilar e marca vierem vazios, o selo simplesmente não é desenhado
      // (desvio documentado, sinalizado no relatório desta entrega). CTA cai no mesmo fallback de
      // "SWIPE →" no carrossel sem cta_arte, mesma regra que engine6() já tinha.
      // FONTE ÚNICA (24/set/2026, "Trocar o motor de imagem e reservar as zonas das pílulas",
      // decisão 5, autorizado pelo João): reaproveita _zonasPills, já calculado CEDO (antes de
      // montar o prompt) pela MESMA função (calcularZonasPills, acima de engine6) que também
      // alimentou a reserva declarada ao modelo — nunca duas contas divergentes, nunca duas
      // chamadas de fonte/rede quando a de cedo já resolveu. Recalcular aqui só entra como
      // fallback DEFENSIVO (mesmo padrão já usado por _vert/alvo, acima) para o caso raro da
      // chamada de cedo ter falhado (ex.: rede instável) — preserva, mesmo nesse caso, o sinal de
      // falha visível (registrarFalhaComposicaoNaOrdem, no catch abaixo) que já existia antes
      // desta rodada: sem o fallback, uma falha só na etapa cedo passaria em silêncio aqui.
      // GATED POR CTA_SELO_POR_CODIGO (25/set/2026, decisão 1) — mesma chave do bloco de reserva
      // antecipada, acima; com ela desligada este bloco inteiro fica dormente (nunca desenha),
      // pronto pra ser religado numa linha (a mesma que liga a reserva e a supressão em engine6).
      if (CTA_SELO_POR_CODIGO && engine !== false) {
        const zonas = _zonasPills || await calcularZonasPills(_vert, M6, pilar, cta_arte, total, targetId).catch(() => null);
        if (zonas && (zonas.selo || zonas.cta)) {
          try {
            let pillsSvg = '';
            if (zonas.selo) pillsSvg += zonas.selo.svg;
            if (zonas.cta) pillsSvg += zonas.cta.svg;
            if (pillsSvg) {
              const svgPills = `<svg width="${zonas.tpl.w}" height="${zonas.tpl.h}" xmlns="http://www.w3.org/2000/svg">${pillsSvg}</svg>`;
              bytes = await sharp(bytes).composite([{ input: Buffer.from(svgPills), left: 0, top: 0 }]).jpeg({ quality: 88, chromaSubsampling: '4:2:0' }).toBuffer();
            }
          } catch (e) {
            // FALHA NUNCA BLOQUEIA A ENTREGA (mesmo princípio do logo, logo abaixo) — mas o CTA é
            // "o elemento de conversão da peça" (palavras do João, "descartado remover o CTA"):
            // uma peça entregue sem ele por falha do compositor precisa ficar VISÍVEL pra quem
            // aprova, não só no log da Vercel — reaproveita registrarFalhaComposicaoNaOrdem, o
            // mesmo mecanismo já usado pela falha do compositor de composição completa (acima).
            console.error('[cta-selo-codigo] composição do CTA/selo por código falhou, peça sai sem eles:', e.message);
            if (conteudo_id) await registrarFalhaComposicaoNaOrdem(conteudo_id, `CTA e/ou selo deveriam ser compostos por código e a composição falhou — peça entregue sem eles: ${e.message}`);
          }
        }
      }
      try {
        const logos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.logo&select=url,created_at&order=created_at.desc&limit=1`, { headers: SBH() }).then(r2 => r2.json());
        const logoUrl = Array.isArray(logos) && logos[0] && logos[0].url;
        if (logoUrl) {
          const im = await baixarImg(logoUrl);
          if (im) {
            const tpl = obterTemplate(_vert);
            const pos = await posicaoLogo(tpl, im.buf);
            bytes = await sharp(bytes)
              .composite([{ input: await sharp(im.buf).resize(pos.width, pos.height, { fit: 'inside' }).toBuffer(), left: pos.left, top: pos.top }])
              .jpeg({ quality: 88, chromaSubsampling: '4:2:0' })
              .toBuffer();
            logoJaComposta = true;
          }
        }
      } catch (e) { console.error('[logo-padrao] colagem da logo falhou, peça sai sem logo:', e.message); }
    } catch (e) { console.error('crop/resize:', e.message); }
    // ACHADO CORRIGIDO JUNTO (22/set/2026, "composição — Fase 1"): b64 (usado mais abaixo como
    // fallback quando o storage falha/demora) ainda apontava para os bytes CRUS da OpenAI, de
    // ANTES do crop — pré-existente, inofensivo até aqui (o fallback só perdia o corte certo de
    // proporção, o texto do próprio modelo continuava na imagem). Com composição ativa isso
    // deixaria de ser cosmético: se o storage falhar DEPOIS de compor() ter colado texto/logo
    // reais, o fallback devolveria a imagem MUDA que a OpenAI gerou antes da composição — a
    // mesma falha que o portão do João proíbe, só que pela porta do storage em vez da do
    // compositor. b64 agora sempre reflete os bytes finais (compostos e/ou cortados e/ou com a
    // logo real colada).
    b64 = bytes.toString('base64');

    // INSTRUMENTO PERMANENTE — PROMPT FINAL (22/set/2026, item 4, autorizado pelo João): "sem
    // ele, qualquer diagnóstico de qualidade é suposição". Grava o texto EXATO mandado ao
    // gpt-image-1 nesta geração, mais o resultado da verificação de texto (se rodou) — uma
    // escrita só, mesclada (mesclarMetaNaOrdem), nunca uma corrida de PATCHes concorrentes.
    // DEFEITO VISÍVEL (24/set/2026, decisão 2): calculado uma vez só, sobre a verificação FINAL
    // (a que efetivamente foi mantida/entregue) — nunca recalculado dentro do objeto do PATCH.
    // COERÊNCIA ANTES DE GERAR (decisão 5, mesma ordem, autorizado pelo João): "a peça é marcada
    // com o mesmo alerta legível que já existe" — reaproveita o MESMO campo alerta_defeito (e a
    // MESMA UI que já lê esse campo em aprovar.html), nunca um campo/aviso paralelo. Prefixado
    // antes do resto (a incoerência nasceu ANTES da peça existir, é o achado mais sério).
    // montarAlertaDefeito() em si fica intocada — só a composição final do texto muda.
    const _alertaDefeitoBase = montarAlertaDefeito(verificacaoTexto);
    const _alertaDefeito = _alertaCoerencia
      ? ('Conteúdo incoerente antes mesmo de gerar — ' + _alertaCoerencia + '. Revise com atenção antes de aprovar.' + (_alertaDefeitoBase ? (' Também: ' + _alertaDefeitoBase) : ''))
      : _alertaDefeitoBase;
    if (conteudo_id) {
      await mesclarMetaNaOrdem(conteudo_id, {
        // 23/set/2026 ("Corte, mockup e teto de texto", autorizado pelo João, decisão 10): o
        // corte de 12.000 caracteres saiu — prompt_final é o instrumento de auditoria ("sem ele,
        // qualquer diagnóstico de qualidade é suposição", item 4 da rodada anterior); cortado, ele
        // cegava justamente a cauda (o briefing de cena, seções finais). O prompt cresceu bastante
        // com a camada VISUAL_SYSTEM (rodada anterior); auditoria precisa do texto inteiro.
        prompt_final: String(promptFinal || ''),
        ...(verificacaoTexto ? { verificacao_texto: verificacaoTexto } : {}),
        // Causa 2, Rodada 2: mesma escrita mesclada, nunca uma segunda gravação concorrente.
        ...(_dnaFaltando.length ? { dna_incompleto: _dnaFaltando } : {}),
        // DEFEITO VISÍVEL (24/set/2026, decisão 2, autorizado pelo João): só grava quando a
        // verificação FINAL (a que efetivamente foi mantida/entregue — verificacaoTexto já é essa,
        // nunca a 1ª tentativa descartada) ainda tem divergência de texto ou elemento em faixa
        // descartada. aprovar.html lê este campo pra exibir o aviso (ver alteração lá).
        // MESMA RESSALVA de dna_incompleto (linha acima, padrão já existente neste arquivo): campo
        // só é ESCRITO quando há defeito — uma peça que teve defeito e foi corrigida por edição
        // manual não limpa este campo sozinha (mesma limitação read-merge-write de sempre, não
        // nova desta rodada; reportado, não corrigido — fora do escopo pedido).
        ...(_alertaDefeito ? { alerta_defeito: _alertaDefeito } : {}),
        // CENA COM MEMÓRIA (24/set/2026, decisão 3): grava o resumo de UMA linha desta peça pra
        // alimentar ctx.cenasRecentes da PRÓXIMA peça do mesmo cliente (ver busca de
        // _cenasRecentes, acima). Só grava quando o Diretor devolveu um resumo de verdade — nunca
        // sobrescreve com string vazia por cima de um resumo anterior (mesma cautela read-merge
        // do resto deste padrão).
        ...(resumoCena ? { cena_resumo: resumoCena } : {}),
        // INSTRUMENTO PERMANENTE — PROMPT E RESPOSTA DO DIRETOR (decisão 1, mesma ordem): mesma
        // cautela read-merge-write de resumoCena, acima — só grava quando há de fato um Diretor
        // que respondeu (nunca sobrescreve com vazio/null por cima de um registro anterior).
        ...(diretorPrompt ? { diretor_prompt: diretorPrompt } : {}),
        ...(diretorResposta ? { diretor_resposta: diretorResposta } : {}),
        // CUSTO E TEMPO POR CHAMADA À OPENAI (24/set/2026, "Trocar o motor de imagem...",
        // "Alterações" item 4, autorizado pelo João) — uma entrada por chamada de verdade feita
        // nesta requisição (1ª tentativa, retry da regeneração dirigida, regeneração de fallback
        // do compositor — ver _chamadasOpenAI, acima de engine6): modelo usado, tempo em ms,
        // usage quando a resposta trouxer. Mesma cautela read-merge-write do resto deste padrão —
        // só grava quando houve de fato alguma chamada.
        ...(_chamadasOpenAI.length ? { openai_chamadas: _chamadasOpenAI } : {}),
      });
    }

    // ECONOMIA DE TEMPO (Hobby 60s): subir no storage e registrar AGORA, mas com timeout curto.
    // Se o storage demorar, devolvemos base64 (a imagem nunca se perde).
    const fileName = `${targetId}/gerados/${Date.now()}.jpg`;
    if (ehReload) { uso.reloads = Number(uso.reloads || 0) + 1; } else { uso.imagens = Number(uso.imagens || 0) + 1; }

    let publicUrl = null;
    try {
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 12000); // máx 12s para o storage
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'image/jpeg' },
        body: bytes, signal: ctrl.signal,
      });
      clearTimeout(tmo);
      if (up.ok) {
        publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-uploads/${fileName}`;
        // No modo preview (registrar===false) NÃO registra na biblioteca aqui — só salva quando o usuário clica Aceitar.
        if (registrar !== false) {
          await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
            method: 'POST', headers: SBH(),
            body: JSON.stringify({ user_id: targetId, categoria: 'gerados', nome: 'Arte IA', url: publicUrl, path: fileName }),
          }).catch(() => {});
        }
      }
    } catch (e) { console.error('storage lento/falhou:', e.message); }

    // registrar uso (rápido)
    await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) }).catch(()=>{});

    // Se veio de um conteúdo planejado (e não é preview), vincula a arte e marca para aprovação
    if (registrar !== false && conteudo_id && publicUrl) {
      await gravarSlide(conteudo_id, publicUrl, slide, total);
    }

    // Se o storage funcionou, manda a URL; senão, manda base64 (imagem garantida)
    return res.status(200).json({
      ok: true,
      url: publicUrl || ('data:image/png;base64,' + b64),
      path: publicUrl ? fileName : null,
      // METADADOS DE AUDITORIA: tornam o resultado auto-descritivo ("gerei ESTA imagem para ESTE
      // conteúdo e ESTE slide, com ESTA engine"). orderId não existe neste escopo — o worker já o tem.
      conteudo_id: conteudo_id || null,
      slide: (slide != null ? Number(slide) : null),
      engine: '6.0',
      usadas: uso.imagens, limite: lim.imagens || 0, reloads_usados: uso.reloads||0, reloads_limite: lim.reloads||0,
      aviso: publicUrl ? undefined : 'base64',
      // LOGO REAL: true quando o SERVIDOR já colou a logo real nesta peça — seja pelo compositor
      // de texto+logo (composição, ver _composicao-lib.js, hoje desligado em toda conta) seja
      // pelo passo padrão novo (item 2, 22/set/2026, roda para todo fluxo). agentes.html usa
      // este sinal para NÃO compor a logo de novo no navegador (comporLogoNaArte), evitando logo
      // duplicada na mesma arte.
      logoJaComposta: logoJaComposta || undefined,
      // VERIFICAÇÃO DE TEXTO (item 3, 22/set/2026): presente só quando rodou (peça com texto
      // renderizado pelo modelo, fora do caminho de composição). Mesmo objeto persistido em
      // conteudos.meta.verificacao_texto quando há conteudo_id — aqui também no preview avulso
      // (sem conteudo_id, sem onde persistir) para o chamador já ver na hora.
      verificacao_texto: verificacaoTexto || undefined,
      // CUSTO E TEMPO (decisão "Alterações" item 4): mesmo objeto persistido em
      // conteudos.meta.openai_chamadas quando há conteudo_id — aqui também no preview avulso, para
      // o chamador (e o relatório desta rodada) já ver modelo/tempo/usage sem precisar do banco.
      openai_chamadas: _chamadasOpenAI.length ? _chamadasOpenAI : undefined,
    });
  } catch (e) {
    console.error('gerar-imagem:', e.message);
    return res.status(500).json({ error: 'Erro interno na geração' });
  }
};
