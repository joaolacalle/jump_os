// api/meta-oauth.js — Instagram Graph API com Login da Empresa (Business Login)
// App tipo Empresa — fluxo OAuth 2.0 via Instagram Business Login
// ENV: META_APP_ID, META_APP_SECRET, SUPABASE_SERVICE_KEY
const SITE = 'https://www.metodojump.com.br';
const REDIRECT = `${SITE}/api/meta-callback`;
// Autenticar o início da conexão Meta (28/set/2026): antes, `uid` vinha cru da query — qualquer
// pessoa podia chamar /api/meta-oauth?tipo=instagram&uid=<id de outro cliente>, autorizar o
// próprio Instagram e o callback (que apaga a conexão anterior antes de inserir) sobrescrevia a
// legítima. O dono passa a vir do JWT — mesmo padrão de api/admin-users.js e api/video-editar.js
// (GET /auth/v1/user com o apikey de serviço). Conectar em nome de outra conta continua possível,
// mas vira decisão do SERVIDOR: só quem tem clientes.role admin/supervisor (mesma fonte de papel
// usada em todo o resto do backend — admin-users.js, agente-chat.js, gerar-imagem.js,
// video-editar.js) pode indicar um `alvo` diferente de si mesmo.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SBH() });
  return r.json();
}

module.exports = async (req, res) => {
  // O endpoint agora recebe credencial (Authorization) — não pode mais ser chamável de
  // qualquer origem.
  res.setHeader('Access-Control-Allow-Origin', SITE);
  try {
    const { tipo } = req.query || {};
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      return res.status(503).json({ error: 'Meta não configurada' });
    }
    if (!tipo || !['instagram','ads'].includes(tipo)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }

    // 1. Identificar quem está chamando, pelo JWT — o uid deixou de vir da query.
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Não autenticado' });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` },
    });
    const requester = await uRes.json();
    if (!uRes.ok || !requester.id) return res.status(401).json({ error: 'Sessão inválida' });

    // 2. `alvo` opcional (conectar em nome de outra conta) — aceito no corpo ou na query.
    // Sem alvo, ou com alvo igual a quem chamou, o dono é o próprio requester (caminho comum,
    // sem checagem extra). Com um alvo diferente, só prossegue se o papel de quem chamou
    // (clientes.role) for admin ou supervisor — senão 403.
    const alvoBruto = (req.body && req.body.alvo) || (req.query && req.query.alvo);
    let uid = requester.id;
    if (alvoBruto && String(alvoBruto) !== requester.id) {
      if (!isUuid(alvoBruto)) return res.status(400).json({ error: 'Parâmetros inválidos' });
      const [me] = await sbGet(`clientes?id=eq.${requester.id}&select=role`);
      const role = (me && me.role) || 'usuario';
      if (role !== 'admin' && role !== 'supervisor') {
        return res.status(403).json({ error: 'Sem permissão para conectar em nome de outra conta' });
      }
      uid = String(alvoBruto);
    }

    // STATE ASSINADO (29/set/2026, "Meta OAuth — assinar o state e validar no callback"): antes,
    // state era só base64url(`${uid}|${tipo}`) — sem assinatura. Como client_id e redirect_uri
    // são públicos, qualquer um montava a URL de autorização na mão com o uid de outra pessoa e o
    // callback (que APAGA a conexão anterior antes de inserir, ~163 de meta-callback.js)
    // sobrescrevia a conexão legítima da vítima. Agora o payload leva também a expiração (30min,
    // em epoch-segundos) e vem seguido de `.` + a assinatura HMAC-SHA256 (chave META_APP_SECRET,
    // já validada acima) do próprio payload em base64url — mesmo formato payload.assinatura já
    // usado pela Meta no signed_request da desautorização (tratarPost, acima neste projeto), só
    // que aqui quem assina somos nós. api/meta-callback.js recalcula e compara antes de trocar
    // qualquer coisa com a Meta.
    const crypto = require('crypto');
    const expiraEm = Math.floor(Date.now() / 1000) + 30 * 60; // 30min
    const payload = Buffer.from(`${uid}|${tipo}|${expiraEm}`).toString('base64url');
    const assinatura = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('base64url');
    const state = `${payload}.${assinatura}`;

    // Instagram Business Login usa endpoint próprio e escopos do Instagram
    const scope = tipo === 'ads'
      ? 'ads_read,ads_management'
      : 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_messages,instagram_business_manage_comments';

    // Endpoint do Instagram Business Login (diferente do Facebook dialog)
    const url = 'https://www.instagram.com/oauth/authorize'
      + `?client_id=${process.env.META_APP_ID}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&scope=${encodeURIComponent(scope)}`
      + `&state=${state}`
      + `&response_type=code`;

    return res.status(200).json({ url });
  } catch (e) {
    console.error('meta-oauth:', e.message);
    return res.status(500).json({ error: 'Erro ao iniciar conexão' });
  }
};
