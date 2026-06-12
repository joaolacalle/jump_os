// api/meta-oauth.js — Inicia conexão OAuth com a Meta (Instagram / Ads)
// ENV: META_APP_ID, META_APP_SECRET
const SITE = 'https://jump-os-one.vercel.app';

const SCOPES = {
  instagram: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
  ads: 'ads_read',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { tipo, uid } = req.query || {};
    if (!process.env.META_APP_ID) {
      return res.status(503).json({ error: 'Meta não configurada' });
    }
    if (!tipo || !SCOPES[tipo] || !uid || !/^[0-9a-f-]{36}$/i.test(uid)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const state = Buffer.from(`${uid}|${tipo}`).toString('base64url');
    const url = 'https://www.facebook.com/v19.0/dialog/oauth'
      + `?client_id=${process.env.META_APP_ID}`
      + `&redirect_uri=${encodeURIComponent(SITE + '/api/meta-callback')}`
      + `&scope=${encodeURIComponent(SCOPES[tipo])}`
      + `&state=${state}&response_type=code`;
    return res.status(200).json({ url });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao iniciar conexão' });
  }
};
