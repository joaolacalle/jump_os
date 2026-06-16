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

    const { prompt, tamanho } = req.body || {};
    if (!prompt || prompt.length < 10) return res.status(400).json({ error: 'Prompt inválido' });
    // DALL·E 3 aceita: 1024x1024, 1024x1792 (retrato), 1792x1024 (paisagem)
    const size = tamanho === '4:5' ? '1024x1792' : tamanho === '16:9' ? '1792x1024' : '1024x1024';

    // DALL·E 3 — text-to-image (retorna URL temporária)
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, size, n: 1, quality: 'standard' }),
    });
    const result = await r.json();
    if (!r.ok) {
      console.error('openai dalle:', JSON.stringify(result).slice(0, 300));
      const msg = (result.error && result.error.message) || 'Falha ao gerar imagem.';
      return res.status(500).json({ error: msg.includes('billing') || msg.includes('quota') ? 'Sem créditos na OpenAI. Adicione em platform.openai.com → Billing.' : 'Falha ao gerar imagem. Tente novamente.' });
    }
    const tempUrl = result.data && result.data[0] && result.data[0].url;
    if (!tempUrl) return res.status(500).json({ error: 'Resposta sem imagem' });

    // Baixar a imagem da URL temporária da OpenAI
    const imgResp = await fetch(tempUrl);
    const bytes = Buffer.from(await imgResp.arrayBuffer());

    // Salvar no Storage do Supabase
    const fileName = `${user.id}/gerados/${Date.now()}.png`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/user-uploads/${fileName}`, {
      method: 'POST',
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'image/png' },
      body: bytes,
    });
    if (!up.ok) { console.error('storage:', await up.text()); return res.status(500).json({ error: 'Falha ao salvar imagem' }); }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-uploads/${fileName}`;

    // Registrar na biblioteca (aba "Gerados por IA")
    await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: user.id, categoria: 'gerados', nome: 'Arte IA', url: publicUrl, path: fileName }),
    }).catch(() => {});

    // Registrar uso de imagem
    uso.imagens = Number(uso.imagens || 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) });

    return res.status(200).json({ ok: true, url: publicUrl, usadas: uso.imagens, limite: lim.imagens || 0 });
  } catch (e) {
    console.error('gerar-imagem:', e.message);
    return res.status(500).json({ error: 'Erro interno na geração' });
  }
};
