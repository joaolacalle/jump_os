// api/meta-oauth.js — Instagram Graph API com Login da Empresa (Business Login)
// App tipo Empresa — fluxo OAuth 2.0 via Instagram Business Login
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

    // Instagram Business Login usa endpoint próprio e escopos do Instagram
    const scope = tipo === 'ads'
      ? 'ads_read,ads_management'
      : 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_messages';

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
