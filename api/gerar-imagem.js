// api/gerar-imagem.js — Geração de criativos via OpenAI gpt-image-1
// Aceita foto real do cliente (image-to-image) quando disponível
// ENV: OPENAI_API_KEY, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({ 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'application/json' });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    // Carrega a conta ALVO (dona dos dados: logo, OS_DATA, uso, limites)
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}&select=*`, { headers: SBH() });
    const [cli] = await cRes.json();
    if (!cli) return res.status(403).json({ error: 'Conta não encontrada' });
    if (cli.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });

    // Reset mensal do uso de imagens
    const mes = new Date().toISOString().slice(0, 7);
    let uso = cli.uso || {};
    if (uso.mes !== mes) { uso = { tokens: 0, imagens: 0, videos: 0, mes }; }
    const lim = cli.limites || {};
    if (lim.imagens && Number(uso.imagens || 0) >= Number(lim.imagens)) {
      return res.status(403).json({ error: 'Limite mensal de imagens atingido.', limite: true });
    }

    const { prompt, tamanho, tipo, slide } = req.body || {};
    if (!prompt || prompt.length < 10) return res.status(400).json({ error: 'Prompt inválido' });
    // gpt-image-1: 1024x1024, 1024x1536 (retrato 4:5), 1536x1024 (paisagem 16:9), auto
    const size = tamanho === '4:5' ? '1024x1536' : tamanho === '16:9' ? '1536x1024' : '1024x1024';

    // Buscar imagens base do acervo: logo SEMPRE; foto pessoal se for post de pessoa
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
      // REGRA CARROSSEL: foto/produto SÓ no primeiro slide (slide 1 ou imagem única).
      // Slides 2+ não usam foto/produto — mantêm só a identidade visual da marca.
      const primeiroSlide = (slide === undefined || slide === null || Number(slide) <= 1);
      // foto pessoal (só quando o post é de pessoa E é o primeiro slide)
      if (tipo === 'pessoa' && primeiroSlide) {
        const fotos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.pessoais&select=url&limit=1`, { headers: SBH() }).then(r => r.json());
        if (Array.isArray(fotos) && fotos[0]) { const im = await baixarImg(fotos[0].url); if (im) baseImgs.push({ ...im, tag: 'pessoa' }); }
      }
      // produto (quando o post é de produto E é o primeiro slide)
      if (tipo === 'produto' && primeiroSlide) {
        const prods = await fetch(`${SUPABASE_URL}/rest/v1/uploads?user_id=eq.${targetId}&categoria=eq.produtos&select=url&limit=1`, { headers: SBH() }).then(r => r.json());
        if (Array.isArray(prods) && prods[0]) { const im = await baixarImg(prods[0].url); if (im) baseImgs.push({ ...im, tag: 'produto' }); }
      }
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
        preserva += ' The provided person photo is the absolute identity source. Keep the EXACT same person: face shape, jawline, nose, eyes, eyebrows, lips, skin texture, marks, freckles, moles, wrinkles, hairline, beard, tattoos, piercings, jewelry, body proportions and age. Do NOT beautify, smooth, slim, rejuvenate or stylize. No lookalike, no inspired version — the exact same individual, as a real photo taken another day. Identity preservation wins over any creative choice. Reject plastic/wax skin, CGI look, distorted hands/face, uncanny valley.';
      }
      if (temProduto) {
        preserva += ' The provided product photo must NOT be altered: keep its exact shape, colors, label, materials and details. Do not redesign, recolor or invent variations of the product. Integrate it realistically into the composition exactly as it is.';
      }
      preserva += ' The provided LOGO must be used EXACTLY as given (same shape and colors), placed ONCE only (typically bottom area), never recreated, redrawn, duplicated or invented. Do NOT add any extra signature, brand name text or second logo anywhere in the image. ===';
      const instr = prompt + preserva;
      form.append('prompt', instr);
      form.append('size', size);
      form.append('quality', 'high');
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
      // text-to-image (sem logo no acervo): NUNCA inventar logo/nome de marca
      const promptSemLogo = prompt + ' IMPORTANT: do NOT create, draw, write, duplicate or invent any logo, brand name, signature or handwriting anywhere in the image (not once, not twice). Leave brand space clean — the real logo will be added separately. Ensure correct letter spacing and legible text. Agency-grade finish: headline with premium texture (metallic/gradient/glow as fits the style), layered cinematic background that tells the brand story, realistic integration with consistent directional lighting and shadows. No flat backgrounds.';
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt: promptSemLogo, size, n: 1, quality: 'high' }),
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

    // Salvar no Storage do Supabase
    const fileName = `${targetId}/gerados/${Date.now()}.png`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/${fileName}`, {
      method: 'POST',
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'image/png' },
      body: bytes,
    });
    if (!up.ok) {
      const et = await up.text();
      console.error('storage:', et);
      // fallback: devolve a imagem como data URL (base64) para o cliente ver/baixar
      uso.imagens = Number(uso.imagens || 0) + 1;
      await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) }).catch(()=>{});
      return res.status(200).json({ ok: true, url: 'data:image/png;base64,'+b64, usadas: uso.imagens, limite: lim.imagens || 0, aviso: 'storage_falhou' });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-uploads/${fileName}`;

    // Registrar na biblioteca (aba "Gerados por IA")
    await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: targetId, categoria: 'gerados', nome: 'Arte IA', url: publicUrl, path: fileName }),
    }).catch(() => {});

    // Registrar uso de imagem
    uso.imagens = Number(uso.imagens || 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) });

    return res.status(200).json({ ok: true, url: publicUrl, usadas: uso.imagens, limite: lim.imagens || 0 });
  } catch (e) {
    console.error('gerar-imagem:', e.message);
    return res.status(500).json({ error: 'Erro interno na geração' });
  }
};
