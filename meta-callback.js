// api/meta-callback.js — Troca código → token → busca Página → Instagram vinculado
// ENV: META_APP_ID, META_APP_SECRET, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SITE = 'https://jump-os-one.vercel.app';
const REDIRECT = `${SITE}/api/meta-callback`;
const GRAPH = 'https://graph.facebook.com/v19.0';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});

async function graph(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${GRAPH}${path}${token ? sep + 'access_token=' + token : ''}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Erro Graph API');
  return d;
}

async function sbDel(table, filter) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SBH() });
}
async function sbIns(table, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: SBH(), body: JSON.stringify(body),
  });
}

module.exports = async (req, res) => {
  const volta = (q) => { res.statusCode = 302; res.setHeader('Location', `${SITE}/conectar-conta.html?${q}`); res.end(); };
  try {
    const { code, state, error } = req.query || {};
    if (error || !code || !state) return volta('erro=autorizacao_cancelada');

    // Decodificar state
    let uid, tipo;
    try { [uid, tipo] = Buffer.from(state, 'base64url').toString().split('|'); }
    catch (e) { return volta('erro=estado_invalido'); }
    if (!uid || !['instagram', 'ads'].includes(tipo)) return volta('erro=estado_invalido');

    // 1. Código → token de curta duração
    const t1 = await graph(`/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT)}&code=${code}`);
    if (!t1.access_token) return volta('erro=token');

    // 2. Token curto → longo (60 dias)
    let longToken = t1.access_token;
    try {
      const t2 = await graph(`/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${t1.access_token}`);
      if (t2.access_token) longToken = t2.access_token;
    } catch (e) { /* usa token curto se falhar */ }

    let nome = 'Conta Meta', meta = {};

    if (tipo === 'instagram') {
      // 3. Buscar Páginas do usuário
      const pages = await graph(`/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,followers_count}`, longToken);
      if (!pages.data || !pages.data.length) return volta('erro=sem_pagina');

      // 4. Achar página com Instagram vinculado
      const pg = pages.data.find(p => p.instagram_business_account);
      if (!pg) return volta('erro=sem_instagram_vinculado');

      const ig = pg.instagram_business_account;
      nome = '@' + (ig.username || pg.name);
      meta = {
        page_id: pg.id,
        page_name: pg.name,
        page_token: pg.access_token,   // token da página (para publicar)
        ig_id: ig.id,
        ig_username: ig.username || '',
        ig_followers: ig.followers_count || 0,
      };
    } else {
      // Ads
      const ads = await graph(`/me/adaccounts?fields=id,name,account_status,currency`, longToken);
      if (!ads.data || !ads.data.length) return volta('erro=sem_conta_ads');
      const ac = ads.data[0];
      nome = ac.name || ac.id;
      meta = { ad_account_id: ac.id, currency: ac.currency || 'BRL' };
    }

    // 5. Salvar no Supabase (remove antiga e insere nova)
    await sbDel('contas_conectadas', `user_id=eq.${uid}&tipo=eq.${tipo}`);
    await sbIns('contas_conectadas', {
      user_id: uid, tipo, nome,
      token: longToken, meta,
    });

    return volta(`conectado=${tipo}`);
  } catch (e) {
    console.error('meta-callback:', e.message);
    // Erros específicos com mensagem amigável
    if (e.message.includes('sem_pagina') || e.message.includes('sem_instagram')) {
      return volta('erro=' + e.message);
    }
    return volta('erro=interno&msg=' + encodeURIComponent(e.message.slice(0, 80)));
  }
};
