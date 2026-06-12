// api/meta-callback.js — Recebe o retorno da Meta, salva a conexão
// ENV: META_APP_ID, META_APP_SECRET, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SITE = 'https://jump-os-one.vercel.app';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const GRAPH = 'https://graph.facebook.com/v19.0';

const H = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
});

async function gget(path) {
  const r = await fetch(`${GRAPH}${path}`);
  return r.json();
}

module.exports = async (req, res) => {
  const volta = (q) => { res.statusCode = 302; res.setHeader('Location', `${SITE}/conectar-conta.html?${q}`); res.end(); };
  try {
    const { code, state, error } = req.query || {};
    if (error || !code || !state) return volta('erro=autorizacao_cancelada');
    let uid, tipo;
    try { [uid, tipo] = Buffer.from(state, 'base64url').toString().split('|'); } catch (e) { return volta('erro=estado_invalido'); }
    if (!uid || !['instagram', 'ads'].includes(tipo)) return volta('erro=estado_invalido');

    // 1. Código → token curto
    const t1 = await gget(`/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(SITE + '/api/meta-callback')}&code=${code}`);
    if (!t1.access_token) return volta('erro=token');

    // 2. Token curto → longo (60 dias)
    const t2 = await gget(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${t1.access_token}`);
    const token = t2.access_token || t1.access_token;

    // 3. Identificar a conta
    let nome = 'Conta Meta', meta = {};
    if (tipo === 'instagram') {
      const pages = await gget(`/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${token}`);
      const pg = (pages.data || []).find(p => p.instagram_business_account) || (pages.data || [])[0];
      if (!pg) return volta('erro=sem_pagina');
      if (!pg.instagram_business_account) return volta('erro=sem_instagram_vinculado');
      nome = '@' + (pg.instagram_business_account.username || pg.name);
      meta = { page_id: pg.id, page_token: pg.access_token, ig_id: pg.instagram_business_account.id };
    } else {
      const ads = await gget(`/me/adaccounts?fields=id,name,account_status&access_token=${token}`);
      const ac = (ads.data || [])[0];
      if (!ac) return volta('erro=sem_conta_ads');
      nome = ac.name || ac.id;
      meta = { ad_account_id: ac.id };
    }

    // 4. Salvar (upsert por user+tipo)
    await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${uid}&tipo=eq.${tipo}`, { method: 'DELETE', headers: H() });
    await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ user_id: uid, tipo, nome, token, meta }),
    });
    return volta(`conectado=${tipo}`);
  } catch (e) {
    console.error('meta-callback:', e.message);
    return volta('erro=interno');
  }
};
