// api/meta-token.js — Conectar Instagram via token manual (modo teste/desenvolvimento)
// Recebe o token gerado no painel da Meta, valida e salva a conexão com os dados reais
// ENV: SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    // Autenticar o usuário do JUMP OS
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Não autenticado' });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` },
    });
    const user = await uRes.json();
    if (!uRes.ok || !user.id) return res.status(401).json({ error: 'Sessão inválida' });

    const { token } = req.body || {};
    if (!token || token.length < 20) return res.status(400).json({ error: 'Token inválido' });

    // 1. Validar token e descobrir o ID do usuário do Instagram
    const meRes = await fetch(`https://graph.instagram.com/v19.0/me?fields=user_id,username&access_token=${token}`);
    const me = await meRes.json();
    if (me.error || !(me.user_id || me.id)) {
      return res.status(400).json({ error: 'Token não reconhecido pela Meta. Gere um novo no painel e tente de novo.' });
    }
    const igId = me.user_id || me.id;

    // 2. Buscar dados completos do perfil
    const profRes = await fetch(`https://graph.instagram.com/v19.0/${igId}?fields=username,name,followers_count,media_count,profile_picture_url&access_token=${token}`);
    const prof = await profRes.json();

    const nome = '@' + (prof.username || me.username || igId);
    const meta = {
      ig_id: igId,
      ig_username: prof.username || me.username || '',
      ig_name: prof.name || '',
      ig_followers: prof.followers_count || 0,
      ig_media: prof.media_count || 0,
      via: 'token_manual',
    };

    // 3. Salvar conexão (substitui a anterior)
    await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${user.id}&tipo=eq.instagram`, { method: 'DELETE', headers: SBH() });
    await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: user.id, tipo: 'instagram', nome, token, meta }),
    });

    // 4. Salvar métricas iniciais (nomes reais da tabela)
    await fetch(`${SUPABASE_URL}/rest/v1/metricas`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({
        user_id: user.id,
        seguidores: prof.followers_count || 0,
        total_posts: prof.media_count || 0,
        data_coleta: new Date().toISOString(),
      }),
    }).catch(() => {});

    return res.status(200).json({ ok: true, perfil: nome, seguidores: prof.followers_count || 0, posts: prof.media_count || 0 });
  } catch (e) {
    console.error('meta-token:', e.message);
    return res.status(500).json({ error: 'Erro ao validar o token' });
  }
};
