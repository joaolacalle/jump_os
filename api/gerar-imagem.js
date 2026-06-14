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
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user.id}&select=*`, { headers: SBH() });
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

    const { prompt, foto_url, tamanho } = req.body || {};
    if (!prompt || prompt.length < 10) return res.status(400).json({ error: 'Prompt inválido' });
    const size = tamanho === '4:5' ? '1024x1536' : tamanho === '16:9' ? '1536x1024' : '1024x1024';

    let result;
    if (foto_url) {
      // image-to-image: baixa a foto do cliente e envia como base
      const imgResp = await fetch(foto_url);
      const buf = Buffer.from(await imgResp.arrayBuffer());
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('image', new Blob([buf], { type: 'image/png' }), 'base.png');
      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      result = await r.json();
      if (!r.ok) { console.error('openai edit:', JSON.stringify(result).slice(0, 300)); return res.status(500).json({ error: 'Falha ao gerar (com foto). Tente sem foto ou de novo.' }); }
    } else {
      // text-to-image puro
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
      });
      result = await r.json();
      if (!r.ok) { console.error('openai gen:', JSON.stringify(result).slice(0, 300)); return res.status(500).json({ error: 'Falha ao gerar imagem. Tente novamente.' }); }
    }

    const b64 = result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) return res.status(500).json({ error: 'Resposta sem imagem' });

    // Salvar no Storage do Supabase
    const fileName = `${user.id}/gerados/${Date.now()}.png`;
    const bytes = Buffer.from(b64, 'base64');
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/${fileName}`, {
      method: 'POST',
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'image/png' },
      body: bytes,
    });
    if (!up.ok) { console.error('storage:', await up.text()); return res.status(500).json({ error: 'Falha ao salvar imagem' }); }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-uploads/${fileName}`;

    // Registrar uso de imagem
    uso.imagens = Number(uso.imagens || 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) });

    return res.status(200).json({ ok: true, url: publicUrl, usadas: uso.imagens, limite: lim.imagens || 0 });
  } catch (e) {
    console.error('gerar-imagem:', e.message);
    return res.status(500).json({ error: 'Erro interno na geração' });
  }
};
