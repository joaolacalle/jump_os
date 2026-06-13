// api/meta-oauth.js — OAuth via Facebook Login (Graph API)
// App tipo Empresa — fluxo por Página do Facebook → Instagram vinculado
// ENV: META_APP_ID, META_APP_SECRET
const SITE = 'https://jump-os-one.vercel.app';
const REDIRECT = `${SITE}/api/meta-callback`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { tipo, uid } = req.query || {};
    if (!process.env.META_APP_ID) {
      return res.status(503).json({ error: 'Meta não configurada' });
    }
    if (!tipo || !['instagram','ads'].includes(tipo) || !uid || !/^[0-9a-f-]{36}$/i.test(uid)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const state = Buffer.from(`${uid}|${tipo}`).toString('base64url');
    // Escopos válidos para app tipo Empresa com Instagram Graph API
    const scope = tipo === 'ads'
      ? 'public_profile,ads_read'
      : 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_insights';
    const url = 'https://www.facebook.com/v19.0/dialog/oauth'
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
