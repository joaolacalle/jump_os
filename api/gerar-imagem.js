// api/gerar-imagem.js — Geração de criativos via OpenAI gpt-image-1
// Aceita foto real do cliente (image-to-image) quando disponível
// ENV: OPENAI_API_KEY, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({ 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'application/json' });

const VERSAO = '2026.07.16-cena-editorial';

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
  const paleta = [P1, P2, P3].filter(Boolean).join(', ');
  const reels = String(o.formato || '').toLowerCase().indexOf('reel') >= 0 || String(o.formato || '').toLowerCase().indexOf('story') >= 0;
  const intens = (M.intensidade_visual || 'MEDIA').toUpperCase();
  const vazio = { BAIXA: '70%', MEDIA: '55-60%', 'MÉDIA': '55-60%', ALTA: '40-50%', EXTREMA: '25-35%' }[intens] || '55-60%';
  const elems = { MINIMAL: '2-4', BALANCED: '4-7', DENSE: '8-12' }[(M.complexidade_visual || 'BALANCED').toUpperCase()] || '4-7';
  const temp = (M.temperatura_emocional || 'PREMIUM').toUpperCase();
  const estilo = (M.estilo_visual || 'EDITORIAL').toUpperCase();

  return [
    'You are an art director creating premium Instagram content following a professional design system. Execute EVERY rule below — they are non-negotiable.',
    reels ? 'FORMAT: vertical 1080x1920 single frame.' : 'FORMAT: Instagram feed/carousel slide.',
    o.total > 1 ? ('CAROUSEL slide ' + (o.slide || 1) + ' of ' + o.total + ': keep grid, composition, lighting, hierarchy, palette, intensity, complexity and temperature IDENTICAL to the other slides. Change ONLY label, headline, specific visual element and support copy.') : '',
    '',
    '=== 1. LOCKED PALETTE (CRITICAL) ===',
    paleta ? ('Use EXCLUSIVELY these colors: ' + paleta + '. CTA color: ' + CTA + ' with locked saturation. Validate before rendering: am I using ONLY these colors? If an external color appears, STOP and fix.') : 'Use a restrained, consistent premium palette (max 3 colors).',
    T1 || T2 ? ('Typography: headline in ' + (T1 || 'a bold grotesque') + ' Bold; support copy in ' + (T2 || T1 || 'a clean sans') + '.') : '',
    DNA ? ('Brand visual DNA: ' + DNA) : '',
    '',
    '=== 2. WORD LIMIT (MAXIMUM 18 VISIBLE WORDS) ===',
    'HEADLINE max 8 words · SUPPORT COPY max 6 words · CTA max 2 words · LABEL does not count (graphic element).',
    'If it does not fit: 1st remove support copy, 2nd shorten headline. LESS text > MORE text.',
    '',
    '=== 3. EVIDENT LABEL ===',
    'The label reads like a small editorial title: immediate visual prominence, 8-12% of composition width, contrast 7:1 minimum, color ' + (CTA || 'the CTA color') + ', highlighted position, never blended into the background.',
    '',
    '=== 4. BRANDING ===',
    'ALLOWED: brand name as plain text, minimalist typographic signature. FORBIDDEN: graphic symbol, icon logo, crest, emblem, complex monogram, invented handwriting.',
    '',
    '=== 5. READING PRIORITY ===',
    'Headline ALWAYS dominant (50-60% of attention) > visual (30-40%) > label (5-10%) > copy+CTA (5-10%). No element may compete above 50% with the headline.',
    '',
    '=== 6. PHOTOGRAPHIC FOCUS CONTROL ===',
    'Photography SUPPORTS the headline, never competes: controlled medium contrast (not hyper-detailed), directional lighting (never flat), luminosity 60-70% max, strategic deep shadow areas, gaze/product pointing toward the headline, subtly blurred background. An over-lit photo competes with the headline — avoid.',
    '',
    '=== 7. MANDATORY NEGATIVE SPACE ===',
    'Leave ' + vazio + ' empty. Do NOT fill every area — empty space has narrative function. Breathing room around the headline (never touch it with elements), minimum 5% height between elements, margins always respected.',
    '',
    '=== 8. VISUAL DEPTH (ANTI-FLAT) — 3 MANDATORY LAYERS ===',
    'FOREGROUND: light overlays, sticker cutouts, opacity 80-100%. MIDGROUND: headline, photo, labels, copy, CTA, opacity 100%. BACKGROUND: base, subtle textures, technical grid, opacity 20-60%. Subtle shadows (stickers 10-15% opacity, 8px offset), controlled overlap, selective background blur.',
    '',
    '=== 9. VISUAL MOVEMENT ===',
    'Eye flow: headline → visual → label → CTA. Strategic diagonals, human gaze pointing to headline/CTA, subtle arrows in ' + (CTA || 'CTA color') + ' (2-3px stroke), progressive contrast (max at headline, decreasing on details).',
    '',
    '=== 10. TEXT TREATMENT (ANTI-GLITCH) ===',
    'Portuguese text 100% correct (ç ã õ é á), perfectly legible, clean alignment, no deformation, no fused or melted letters, no wrong line breaks, consistent kerning, readable on mobile.',
    '',
    '=== 11. HUMAN MODE ===',
    'Subtly add: grain 2-5%, noise 1-3%, light print texture, organic micro-wear. NEVER artificial, exaggerated or forced vintage. Goal: a real campaign, not an AI render.',
    '',
    '=== 12. SAFE ZONES ===',
    'CANVAS (real output): ' + (o.canvas || '1024x1536 portrait (2:3)') + '. Compose for THIS exact canvas — do not assume any other aspect ratio.',
    reels ? 'REELS safe zones, in PERCENT of the canvas (the Instagram UI covers these): top 13%, sides 8%, bottom 17%. NEVER place important text there.'
          : 'FEED/CAROUSEL safe zones, in PERCENT of the canvas: top 9%, sides 8%, bottom 10%. NEVER place important text there.',
    '',
    '=== 13. PARAMETERS ===',
    'Intensity: ' + intens + ' (' + vazio + ' empty). Complexity: ' + elems + ' elements. Emotional temperature: ' + temp + '. Base style: ' + estilo + '.',
    '',
    '=== CONTENT OF THIS PIECE ===',
    'LABEL: "' + String(o.label || o.pilar || 'JUMP').toUpperCase() + '"',
    'HEADLINE (dominant, max 8 words): "' + (o.headline || o.tema || '') + '"',
    o.copy ? ('SUPPORT COPY (max 6 words — extract the essence, never render this text raw): "' + cortarFrase(o.copy, 90) + '"') : '',
    'CTA (max 2 words): "' + (o.cta || (o.total > 1 ? 'SWIPE →' : 'SAIBA MAIS')) + '"',
    o.oferta ? ('OFFER BADGE: "' + o.oferta + '"') : '',
    '',
    'QUALITY: ultra detailed, Instagram production-ready, premium finish. Validate the checklist before rendering: word count ≤18? palette locked? label 8-12% at 7:1? headline dominant 50-60%? 3 depth layers? negative space ' + vazio + '? safe zones respected? spelling perfect?',
  ].filter(Boolean).join('\n');
}



// ═══════════════════════════════════════════════════════════════════════════
// A1 — DIRETOR DE ARTE (a etapa que faltava)
// O gpt-image-1 não raciocina: joga-se 13 seções de regras nele e ele perde as
// últimas (grain, movimento, foco). Aqui um modelo de TEXTO lê o Engine 6.0 (lei)
// + o DNA do Negócio e ESCREVE A CENA FINAL — é o que o ChatGPT faz quando o
// cliente cola o Engine na mão. Se falhar, cai no Engine puro (nunca derruba).
// ═══════════════════════════════════════════════════════════════════════════
const MODEL_DIRETOR = () => process.env.AGENT_MODEL_DIRETOR || 'claude-haiku-4-5';

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
  'S1c. IF A REAL PHOTO IS ATTACHED: the set is built AROUND that photo. The subject is transplanted and re-lit, never re-shot. The photo does not bend to serve the set — the set bends to serve the photo. Never describe the subject itself: describe only WHERE it sits, HOW the light falls on it, and the world around it.',
  'S2. THE HEADLINE IS A PHYSICAL OBJECT, NOT AN OVERLAY: give it a real material (cast concrete, brushed or galvanised steel letters bolted to the wall, painted stencil, extruded metal, letterpress) mounted INSIDE the set — receiving the same light, casting real directional shadows, carrying the same grain as the wall. Write it explicitly: "the letters are physical objects in the scene, lit by the lamp, casting their own shadows — not a graphic overlay".',
  'S3. PRACTICAL LIGHT IN FRAME: one visible light fixture inside the shot (hanging industrial lamp, neon tube, window shaft, desk lamp). Describe the cone, the hotspot on the surface, and the falloff — 60-75% of the canvas drops to near-black or deep shadow. Flat, even lighting is a FAILURE.',
  'S4. CAMERA: state focal length, camera height, distance and depth of field (e.g. "35mm, camera at chest height, 2m from the wall, f/2.8, foreground softly out of focus").',
  'S5. ACCENT AS LIGHT: the accent colour enters as a PHYSICAL LIGHT SOURCE in the environment (a small neon sign, an exit light, a coloured gel glowing on a far corner of the wall), plus the label and the CTA. Never as a highlighter.',
  'S6. EVERY SINGLE PIECE OF TEXT IS PHYSICAL MATTER — not only the headline. The label, the support copy and the CTA are engraved plaques, lit signage, printed cards, embossed panels or cut vinyl EXISTING IN THE SET, each catching the light and casting its own small shadow. Small painted lettering is where this model hallucinates (it rendered "SAIBA MAIS" as "SMEA MAS"): text made of matter does not hallucinate. They stay small and quiet — the scene carries the weight — but they are objects.',
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

async function diretorDeArte(M, o, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const engine = engine6(M, o);
  const modo = escolherModo(o, ctx);
  const sys = [
    'You are an award-winning art director for premium Brazilian Instagram brands.',
    'You receive a DESIGN SYSTEM (it is LAW — never violate, never omit) and a content brief.',
    'Your job: write ONE final, dense, concrete image-generation prompt in English for an image model that does NOT reason. It renders literally what you describe — so describe matter, not intentions.',
    '',
    '=== LAW 0 — THERE IS ALWAYS A REAL PHOTOGRAPHIC LAYER (absolute) ===',
    'Every reference-grade piece is built on real photographic matter. Text floating on an empty coloured background, decorated with a few outlined shapes, is an AMATEUR FAILURE and is forbidden. Whatever the mode: real surfaces, real objects, real light, real depth, real grain.',
    '',
    modo === 'cena' ? BLOCO_CENA : BLOCO_EDITORIAL,
    '',
    '=== HOW TO WRITE IT (both modes) ===',
    '1. Total concreteness. Describe the finished piece as it physically is: where each element sits (upper-left, lower third), sizes as % of canvas, colours by HEX, direction of light, material, texture, depth. Never restate a rule as a rule ("the headline must dominate" WRONG -> "the headline sits upper-left, cap-height ~11% of canvas height, three short lines, the brightest object in the frame" RIGHT).',
    '2. DOMINANCE IS WON BY LIGHT AND CONTRAST — NEVER BY SIZE. The headline is the brightest, highest-contrast thing in the frame while everything else sits in shadow or low contrast. It occupies AT MOST 30% of the canvas area (cap-height 8-14% of canvas height). A headline that fills half the canvas is a slide deck, not a campaign: FAILURE.',
    '3. LENGTH IS YOUR RESPONSIBILITY — BUT MEANING OUTRANKS LENGTH. If the headline exceeds 8 words, REWRITE it into a COMPLETE, SELF-CONTAINED statement of 8 words or fewer. Do NOT truncate, do NOT trim words off the end: rewrite. A fragment that leaves the reader asking "...what?" is a FAILURE worse than a long headline — "POR QUE AGENTE DE IA VAI MUDAR" (change WHAT?) is broken; "SEU CONCORRENTE JÁ AUTOMATIZOU" is complete. Read your headline back and ask: does this stand alone and land? If not, rewrite it again. Same for support copy: rewrite to 6 words maximum, always a complete thought. NEVER render a sentence cut off mid-thought.',
    '4. TYPOGRAPHY: never name a font. Describe weight, width, stroke contrast, terminals, corner treatment, tracking, case, line-height. Mixing weight or colour inside the headline is allowed ONLY per whole line (line 1 neutral, line 2 accent) — never per random word.',
    '5. ACCENT DISCIPLINE: the accent colour appears in exactly 3-4 places and they are STRUCTURAL (label pill, thin rule, CTA pill, the thematic graphic, icon strokes) or, in CENA mode, physical light. STRICTLY FORBIDDEN: underlining words, highlighting or colouring isolated words inside the headline. That is a marker pen, not art direction.',
    '6. NEGATIVE SPACE IS ATMOSPHERE, NOT BLANK. The empty percentage the design system asks for means "no elements there" — that area must still be full of matter: textured surface, light falloff, gradient, grain, dust in the light beam. A flat empty area is a FAILURE.',
    '7. HUMAN MODE: visible film grain 3-5% across the ENTIRE frame, micro-wear, real optics and real shadows. Goal: a photograph of a real campaign, not an AI render.',
    '8. ALWAYS bake in explicitly: the depth layers, the safe zones, the label prominence, the eye-flow. These are exactly the rules weak prompts drop.',
    '',
    '=== SPECIFICS ===',
    ctx.temFoto ? 'A REAL PHOTO of the client is attached. It is FIXED — the person is transplanted into the scene and re-lit, never re-photographed. Describe ONLY: which side they sit on, the crop, how the light of the set falls on them, gaze direction pointing toward the headline, contact shadow. YOU ARE FORBIDDEN from describing the person AT ALL — no face, no hair, no beard, no tattoos, no jewellery, no build, no age, no clothing detail, not one adjective about them. Every word you write about the subject is a word the generator will use to REDRAW them. Describe the world around them; the photo defines the person.' : 'No real photo of a person is attached: never invent a generic AI person. Build the piece from the set, objects, materials and light.',
    ctx.temProduto ? 'A REAL PRODUCT photo is attached. It is FIXED and it is a real product a real customer will receive — altering it makes this false advertising. It is the hero of the photographic zone. Describe ONLY where it sits, the surface under it, the light hitting it and its contact shadow. YOU ARE FORBIDDEN from describing the product itself — not its shape, colour, label, filling, topping or finish. Every adjective you write about it is permission for the generator to redesign it.' : '',
    'Never include any logo, symbol, emblem, monogram, watermark or invented brand mark. The brand mark is applied later by the system.',
    o.headline ? '' : 'NO HEADLINE WAS PROVIDED (free-form request): write the headline yourself from the theme — maximum 8 words, punchy, in Portuguese. Never dump the whole briefing as the headline.',
    ctx.variacao ? ('THIS IS A RECREATION — the client rejected the previous version. CHANGE ' + ctx.variacao + '% of the artwork: ' + ({
      25: 'keep the concept and layout; change the light, textures, secondary elements, crop and colour accents. Same idea, fresh execution.',
      50: 'keep the brand system and the headline, but rebuild the composition: different structure, different visual metaphor, different placement and photographic treatment.',
      100: 'start over. New set, new concept, new metaphor, new composition, new light. Only the palette, the typography rules and the text stay. It must not resemble the previous version.',
    }[ctx.variacao] || 'change the composition meaningfully.')) : '',
    ctx.ajuste ? ('THE CLIENT ASKED SPECIFICALLY: "' + String(ctx.ajuste).slice(0, 300) + '". This instruction OVERRIDES your own preferences (but never the design system).') : '',
    '',
    '=== TEXT TO RENDER (accent bug — the model invents accents) ===',
    'End the prompt with a short list titled "Text to render:", one line per string, each between double quotes, in Brazilian Portuguese, EXACTLY as it must appear after your rewrite. Check every line: correct spelling and correct accents (ja -> "já", automatizou, concorrente, você, não, negócios).',
    'Then append this sentence verbatim: "Render every line character-for-character. Do NOT add, remove or invent any accent mark. Words written without an accent must stay without an accent. Do not add any other text anywhere in the image."',
    '',
    'OUTPUT: only the final prompt. No preamble, no bullet points, no explanations, no markdown. 240-400 words: one dense paragraph, then the "Text to render:" list.',
  ].filter(Boolean).join('\n');

  const user = 'DESIGN SYSTEM (LAW):\n' + engine + '\n\nWrite the final image prompt now.';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 1400, system: sys, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) { console.error('diretor:', (await r.text()).slice(0, 160)); return null; }
    const d = await r.json();
    const t = (d.content || []).map(c => c.text || '').join('').trim();
    return t.length > 120 ? t : null; // resposta curta demais = não confiável
  } catch (e) { console.error('diretor:', e.message); return null; }
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
        const t = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL_DIRETOR(), max_tokens: 4, messages: [{ role: 'user', content: 'oi' }] }),
        });
        if (t.ok) diretor = MODEL_DIRETOR() + ' ACESSÍVEL ✅';
        else { const j = await t.json().catch(() => ({})); diretor = 'FALHOU ❌ ' + String((j.error && j.error.message) || t.status).slice(0, 110); }
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
      quality: 'medium (decisão de custo do João; a preservação vem do CONTRATO-MOLDURA + input_fidelity, não da qualidade)',
      contrato_preservacao: 'moldura (abre e fecha) + duas colunas TRAVADO/LIBERADO + lista enumerada',
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    // Auth
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Não autenticado' });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` } });
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
      if (conteudo_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudo_id}`, {
          method: 'PATCH', headers: SBH(),
          body: JSON.stringify({ midia_url: url, status: 'aguardando_aprovacao' })
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, registrado: true });
    }

    // Carrega a conta ALVO (dona dos dados: logo, OS_DATA, uso, limites)
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}&select=*`, { headers: SBH() });
    const [cli] = await cRes.json();
    if (!cli) return res.status(403).json({ error: 'Conta não encontrada' });
    if (cli.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });

    // Reset mensal do uso de imagens
    const mes = new Date().toISOString().slice(0, 7);
    let uso = cli.uso || {};
    if (uso.mes !== mes) { uso = { tokens: 0, imagens: 0, reloads: 0, videos: 0, mes }; }
    let lim = cli.limites || {};
    const { prompt, tamanho, tipo, slide, conteudo_id, reload, registrar, headline, copy, oferta, formato, pilar, total, engine, variacao, ajuste, modo, origem } = req.body || {};

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
    // gpt-image-1 só aceita: 1024x1024 (1:1), 1024x1536 (retrato 2:3), 1536x1024 (paisagem 3:2).
    // '9:16' NÃO existe aqui — antes caía no else e virava QUADRADO (reels saía cortado).
    const t = String(tamanho || '4:5');
    const size = (t === '16:9') ? '1536x1024' : (t === '1:1') ? '1024x1024' : '1024x1536';
    // O Diretor precisa saber a TELA REAL, senão compõe para um formato que não existe.
    const canvas = size === '1024x1536' ? '1024x1536 portrait (2:3)' : size === '1536x1024' ? '1536x1024 landscape (3:2)' : '1024x1024 square (1:1)';

    // Buscar imagens base do acervo: logo SEMPRE; foto pessoal se for post de pessoa
    // OS_DATA REAL: sem isto o prompt pedia "siga a identidade visual" sem NUNCA enviar as cores/fontes.
    const M6 = {};
    try {
      const mems = await fetch(`${SUPABASE_URL}/rest/v1/memorias?user_id=eq.${targetId}&select=chave,valor`, { headers: SBH() }).then(r => r.json());
      (Array.isArray(mems) ? mems : []).forEach(m => { M6[m.chave] = m.valor; });
    } catch (e) {}

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
      if ((tipo === 'pessoal' || tipo === 'pessoa_conceito') && primeiroSlide) {
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
      // TIPO 'pessoa_conceito' = pessoa GENÉRICA criada pela IA (família, dormindo, equipe) → NÃO usa foto real (text-to-image livre).
      // TIPO 'conceitual' = sem pessoa → também text-to-image livre.
      // (ambos caem no else de text-to-image; a logo ainda é aplicada se houver)
    } catch (e) { console.error('acervo:', e.message); }

    let r;
    if (baseImgs.length) {
      // image-to-image: usa foto/logo reais como base (preserva identidade + logo verdadeira)
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      const temPessoa = baseImgs.some(b => b.tag === 'pessoa');
      const temProduto = baseImgs.some(b => b.tag === 'produto');
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
      const travados = [];
      if (temPessoa) travados.push('face shape and geometry', 'jawline', 'nose', 'eyes and eyebrows', 'lips', 'skin texture, marks, freckles, moles, wrinkles', 'hairline and haircut', 'beard', 'tattoos (exact artwork, placement and scale)', 'necklace, watch, rings, glasses, piercings and every accessory worn', 'body proportions', 'apparent age');
      if (temProduto) travados.push('product silhouette and proportions', 'exact colours', 'label artwork and the typography printed on it', 'surface texture and material', 'filling, topping, coating and internal detail', 'finish and gloss', 'the exact count/quantity of items shown');
      const LIBERADOS = 'clothing, pose, body position, framing and crop, background, environment and set, lighting, shadows, colour grade and film grain, and the surface the subject or product rests on';

      const cabecalho = travados.length
        ? '=== PRESERVATION CONTRACT — READ BEFORE ANYTHING ELSE (OUTRANKS EVERY OTHER INSTRUCTION BELOW) ==='
          + ' The attached photo is REAL and it is the source of truth. The subject in it is NOT re-photographed and NOT re-rendered: it is transplanted into the scene and re-lit.'
          + ' Everything described below builds the world AROUND the attached photo — the photo never bends to serve the scene, the scene bends to serve the photo.'
          + ' YOU MAY freely change: ' + LIBERADOS + '.'
          + ' YOU MAY NOT change anything about the subject itself. If any instruction below conflicts with this contract, this contract wins and that instruction is discarded.'
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
      const oArte = { tema: prompt, headline, copy, oferta, formato, pilar, slide, total, tipo, canvas, modo };
      const dirTxt = (engine === false) ? null : await diretorDeArte(M6, oArte, { temFoto: temPessoa, temProduto, variacao: Number(variacao) || 0, ajuste });
      // MOLDURA: contrato → cena → contrato. Nunca só no rodapé.
      const instr = cabecalho + (engine === false ? prompt : (dirTxt || engine6(M6, oArte))) + preserva;
      form.append('prompt', instr);
      form.append('size', size);
      form.append('quality', 'medium');
      // input_fidelity=high é o que REALMENTE preserva rosto/logo numa edição.
      // Sem ele o modelo redesenha a pessoa (era a causa das fotos distorcidas).
      form.append('input_fidelity', 'high');
      // Ordem: referência principal (pessoa/produto) primeiro, logo por último
      const ordemImg = { pessoa: 0, produto: 1, logo: 2 };
      baseImgs.sort((a, b) => (ordemImg[a.tag] ?? 9) - (ordemImg[b.tag] ?? 9));
      for (const b of baseImgs) {
        form.append('image[]', new Blob([b.buf], { type: b.ct }), `${b.tag}.png`);
      }
      r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
    } else {
      // text-to-image: pessoa_conceito pode criar gente genérica; conceitual sem pessoa
      let extra = ' IMPORTANT: do NOT create, draw, write, duplicate or invent any logo, brand name, signature or handwriting in the image — leave brand space clean (the real logo is added separately). All text spelling 100% correct in Portuguese (ç ã õ é á), perfect kerning, no melted/fused letters.';
      if (tipo === 'pessoa_conceito') {
        // Só cai aqui se o cliente NÃO tem foto na pasta (senão usa a real, acima).
        extra += ' Includes a realistic generic person/people (not a specific real individual), photorealistic, never illustration or cartoon.';
      } else if (tipo === 'conceitual') {
        extra += ' NO people — use objects, mockups, screenshots, graphics or abstract elements.';
      }
      const oArte2 = { tema: prompt, headline, copy, oferta, formato, pilar, slide, total, tipo, canvas, modo };
      const dirTxt2 = (engine === false) ? null : await diretorDeArte(M6, oArte2, { temFoto: false, temProduto: false, variacao: Number(variacao) || 0, ajuste });
      const promptSemLogo = (engine === false ? prompt : (dirTxt2 || engine6(M6, oArte2))) + extra;
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: promptSemLogo, size, n: 1, quality: 'medium' }),
      });
    }
    const result = await r.json();
    if (!r.ok) {
      const detalhe = (result.error && result.error.message) || JSON.stringify(result).slice(0, 200);
      console.error('openai gpt-image:', detalhe);
      let amigavel = 'Falha ao gerar imagem. Tente novamente.';
      if (/billing|quota|insufficient/i.test(detalhe)) amigavel = 'Sem créditos na OpenAI. Adicione em platform.openai.com → Billing.';
      else if (/content_policy|safety|moderation/i.test(detalhe)) amigavel = 'O conteúdo do prompt foi recusado pela OpenAI. Ajuste a descrição e tente de novo.';
      else if (/size|dimension/i.test(detalhe)) amigavel = 'Formato de imagem inválido. Tente outro tamanho.';
      else if (/api key|invalid|authentication/i.test(detalhe)) amigavel = 'Chave da OpenAI inválida. Verifique a OPENAI_API_KEY na Vercel.';
      else if (/verif|organization|access|must be verified/i.test(detalhe)) amigavel = 'Sua organização OpenAI precisa ser verificada para usar o gpt-image-1. Acesse platform.openai.com → Settings → Organization → Verify.';
      else if (/does not exist|model/i.test(detalhe)) amigavel = 'Modelo de imagem indisponível na sua conta. Verifique o acesso ao gpt-image-1 na OpenAI.';
      return res.status(500).json({ error: amigavel, detalhe: detalhe.slice(0, 160) });
    }
    // gpt-image-1 retorna base64 diretamente
    const b64 = result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) return res.status(500).json({ error: 'Resposta sem imagem' });
    const bytes = Buffer.from(b64, 'base64');

    // ECONOMIA DE TEMPO (Hobby 60s): subir no storage e registrar AGORA, mas com timeout curto.
    // Se o storage demorar, devolvemos base64 (a imagem nunca se perde).
    const fileName = `${targetId}/gerados/${Date.now()}.png`;
    if (ehReload) { uso.reloads = Number(uso.reloads || 0) + 1; } else { uso.imagens = Number(uso.imagens || 0) + 1; }

    let publicUrl = null;
    try {
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), 12000); // máx 12s para o storage
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'image/png' },
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
      await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${conteudo_id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ midia_url: publicUrl, status: 'aguardando_aprovacao' })
      }).catch(() => {});
    }

    // Se o storage funcionou, manda a URL; senão, manda base64 (imagem garantida)
    return res.status(200).json({
      ok: true,
      url: publicUrl || ('data:image/png;base64,' + b64),
      path: publicUrl ? fileName : null,
      usadas: uso.imagens, limite: lim.imagens || 0, reloads_usados: uso.reloads||0, reloads_limite: lim.reloads||0,
      aviso: publicUrl ? undefined : 'base64'
    });
  } catch (e) {
    console.error('gerar-imagem:', e.message);
    return res.status(500).json({ error: 'Erro interno na geração' });
  }
};
