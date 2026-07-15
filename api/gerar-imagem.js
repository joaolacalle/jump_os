// api/gerar-imagem.js — Geração de criativos via OpenAI gpt-image-1
// Aceita foto real do cliente (image-to-image) quando disponível
// ENV: OPENAI_API_KEY, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({ 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'application/json' });


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
    reels ? 'REELS: 250px top (Instagram UI), 90px sides, 320px bottom (buttons + caption). NEVER place important text there.'
          : 'CAROUSEL/FEED: 120px top, 90px sides, 140px bottom. NEVER place important text there.',
    '',
    '=== 13. PARAMETERS ===',
    'Intensity: ' + intens + ' (' + vazio + ' empty). Complexity: ' + elems + ' elements. Emotional temperature: ' + temp + '. Base style: ' + estilo + '.',
    '',
    '=== CONTENT OF THIS PIECE ===',
    'LABEL: "' + String(o.label || o.pilar || 'JUMP').toUpperCase() + '"',
    'HEADLINE (dominant, max 8 words): "' + (o.headline || o.tema || '') + '"',
    o.copy ? ('SUPPORT COPY (max 6 words, extract the essence): "' + String(o.copy).slice(0, 90) + '"') : '',
    'CTA (max 2 words): "' + (o.cta || (o.total > 1 ? 'SWIPE →' : 'SAIBA MAIS')) + '"',
    o.oferta ? ('OFFER BADGE: "' + o.oferta + '"') : '',
    '',
    'QUALITY: ultra detailed, Instagram production-ready, premium finish. Validate the checklist before rendering: word count ≤18? palette locked? label 8-12% at 7:1? headline dominant 50-60%? 3 depth layers? negative space ' + vazio + '? safe zones respected? spelling perfect?',
  ].filter(Boolean).join('\n');
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
    return res.status(200).json({ diagnostico: true, tem_OPENAI_API_KEY: temChave, teste_openai: openai });
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
    const { prompt, tamanho, tipo, slide, conteudo_id, reload, registrar, headline, copy, oferta, formato, pilar, total } = req.body || {};

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
    // gpt-image-1: 1024x1024, 1024x1536 (retrato 4:5), 1536x1024 (paisagem 16:9), auto
    const size = tamanho === '4:5' ? '1024x1536' : tamanho === '16:9' ? '1536x1024' : '1024x1024';

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
      // logo da marca (sempre que existir)
      const logos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.logo&select=url&limit=1`, { headers: SBH() }).then(r => r.json());
      if (Array.isArray(logos) && logos[0]) { const im = await baixarImg(logos[0].url); if (im) baseImgs.push({ ...im, tag: 'logo' }); }
      // REGRA CARROSSEL: foto/produto reais SÓ no primeiro slide (capa).
      const primeiroSlide = (slide === undefined || slide === null || Number(slide) <= 1);
      // TIPO 'pessoal' = FOTO REAL do cliente (preservação). Só no 1º slide.
      if (tipo === 'pessoal' && primeiroSlide) {
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
      // Identity/Product Preservation Engine (destilado) — preservação absoluta
      let preserva = ' === PRESERVATION LOCK (ABSOLUTE PRIORITY OVER STYLE) ===';
      if (temPessoa) {
        preserva += ' The provided person photo is the absolute identity source — this is a PHOTOREALISTIC composition, NOT an illustration, cartoon, vector or drawing. Keep the EXACT same person: face shape, jawline, nose, eyes, eyebrows, lips, skin texture, marks, freckles, moles, wrinkles, hairline, beard, tattoos, piercings, jewelry, body proportions and age. Do NOT beautify, smooth, slim, rejuvenate or stylize. No lookalike, no inspired version — the exact same individual, as a real photo taken another day. Identity preservation wins over any creative choice. Reject plastic/wax skin, CGI look, illustration, distorted hands/face, uncanny valley.';
      }
      if (temProduto) {
        preserva += ' The provided product photo must NOT be altered: keep its exact shape, colors, label, materials and details. Do not redesign, recolor or invent variations of the product. Integrate it realistically into the composition exactly as it is.';
      }
      preserva += ' The provided LOGO must be used EXACTLY as given (same shape and colors), placed ONCE only (typically bottom area), never recreated, redrawn, duplicated or invented. Do NOT add any extra signature, brand name text or second logo anywhere in the image. ===';
      const instr = engine6(M6, { tema: prompt, headline, copy, oferta, formato, pilar, slide, total, tipo }) + preserva;
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
        extra += ' Includes a realistic generic person/people (not a specific real individual), photorealistic, never illustration or cartoon.';
      } else if (tipo === 'conceitual') {
        extra += ' NO people — use objects, mockups, screenshots, graphics or abstract elements.';
      }
      const promptSemLogo = engine6(M6, { tema: prompt, headline, copy, oferta, formato, pilar, slide, total, tipo }) + extra;
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
