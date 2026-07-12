// api/meta-callback.js — Instagram Business Login callback
// Troca código por token → busca dados do perfil Instagram
// ENV: META_APP_ID, META_APP_SECRET, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SITE = 'https://www.metodojump.com.br';
const REDIRECT = `${SITE}/api/meta-callback`;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});
async function sbDel(table, filter) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SBH() });
}
async function sbIns(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SBH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`gravação falhou (${r.status}): ${txt.slice(0, 140)}`);
  }
}
// Desautorização / Exclusão de dados (Meta envia POST com signed_request)
async function tratarPost(req, res) {
  try {
    let raw = '';
    await new Promise((ok) => { req.on('data', (d) => raw += d); req.on('end', ok); });
    const body = new URLSearchParams(raw);
    const sr = body.get('signed_request') || (req.body && req.body.signed_request) || '';
    const [sig, payload] = String(sr).split('.');
    if (!payload) return res.status(400).json({ error: 'signed_request ausente' });
    // valida a assinatura HMAC-SHA256 com o segredo do app
    const crypto = require('crypto');
    const esperado = crypto.createHmac('sha256', process.env.META_APP_SECRET || '')
      .update(payload).digest('base64url');
    if (sig !== esperado) return res.status(401).json({ error: 'assinatura inválida' });
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const igUser = String(dados.user_id || '');
    if (igUser) {
      // apaga a conexão (token + dados da Meta) do usuário que removeu o app
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&meta->>ig_id=eq.${igUser}`, {
        method: 'DELETE', headers: SBH(),
      }).catch(() => {});
    }
    // resposta no formato que a Meta espera para exclusão de dados
    const code = 'jump-' + (igUser || 'x') + '-' + Date.now().toString(36);
    return res.status(200).json({ url: `${SITE}/exclusao-dados.html`, confirmation_code: code });
  } catch (e) {
    console.error('meta-desautorizacao:', e.message);
    return res.status(200).json({ ok: true }); // nunca falhar o handshake da Meta
  }
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return tratarPost(req, res);
  const volta = (q) => {
    res.statusCode = 302;
    res.setHeader('Location', `${SITE}/conectar-conta.html?${q}`);
    res.end();
  };
  try {
    const { code, state, error } = req.query || {};
    if (error || !code || !state) return volta('erro=autorizacao_cancelada');
    let uid, tipo;
    try { [uid, tipo] = Buffer.from(state, 'base64url').toString().split('|'); }
    catch (e) { return volta('erro=estado_invalido'); }
    if (!uid) return volta('erro=estado_invalido');
    // 1. Código → token curto (endpoint do Instagram)
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT,
        code,
      }),
    });
    const t1 = await tokenRes.json();
    if (!t1.access_token) {
      console.error('token curto:', JSON.stringify(t1));
      return volta('erro=token');
    }
    // 2. Token curto → longo (Graph API — 60 dias)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.META_APP_SECRET}&access_token=${t1.access_token}`
    );
    const t2 = await longRes.json();
    const longToken = t2.access_token || t1.access_token;
    const igUserId = t1.user_id || t2.user_id;
    // Calcula a expiração (expires_in vem em segundos; padrão 60 dias)
    const expiraSeg = Number(t2.expires_in) || (60 * 24 * 3600);
    const tokenExpiraEm = new Date(Date.now() + expiraSeg * 1000).toISOString();
    // 3. Buscar dados do perfil
    const profRes = await fetch(
      `https://graph.instagram.com/v19.0/${igUserId}?fields=id,username,name,followers_count,media_count,profile_picture_url&access_token=${longToken}`
    );
    const prof = await profRes.json();
    const nome = '@' + (prof.username || igUserId);
    const meta = {
      ig_id: igUserId,
      ig_username: prof.username || '',
      ig_name: prof.name || '',
      ig_followers: prof.followers_count || 0,
      ig_media: prof.media_count || 0,
      token_expira_em: tokenExpiraEm,   // ← NOVO: para a renovação automática
      via: 'oauth',
    };
    // 4. Salvar conexão
    await sbDel('contas_conectadas', `user_id=eq.${uid}&tipo=eq.instagram`);
    await sbIns('contas_conectadas', {
      user_id: uid, tipo: 'instagram', nome, token: longToken, meta,
    });
    return volta('conectado=instagram');
  } catch (e) {
    console.error('meta-callback:', e.message);
    return volta('erro=interno&msg=' + encodeURIComponent(e.message.slice(0, 80)));
  }
};
