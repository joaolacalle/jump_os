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
      // apaga a conexão (token + dados da Meta) do usuário que removeu o app.
      // igUser (user_id do signed_request da Meta) é o id "app-scoped" — mesma semântica de
      // meta.ig_app_id. Casa por ig_id OU ig_app_id (mesmo padrão da trava anti-pirataria e do
      // wContaPorIg do cron) para continuar encontrando tanto conexões antigas (só tinham esse id
      // sob a chave ig_id) quanto as novas (rodada "Inscrição no webhook", 26/set/2026).
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&or=(meta->>ig_id.eq.${igUser},meta->>ig_app_id.eq.${igUser})`, {
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
    // 3. Buscar dados do perfil (v23.0). SEM o campo `id`: é o único campo que este endpoint pede
    // em todo o projeto, e este é o único ponto que falhava (a conexão atual ficou como
    // @27148999514741440, sem username) — jobMetricas (username,followers_count,media_count) e
    // meta-token.js (user_id,username) funcionam e não pedem `id`. Ver "Correção do id do perfil
    // no callback do Instagram", 28/set/2026: segue o precedente do meta-token.js, que funciona —
    // `user_id` é a fonte do id da conta profissional, não `id`.
    const IG_API_V = 'v23.0';
    const profRes = await fetch(
      `https://graph.instagram.com/${IG_API_V}/me?fields=username,user_id,name,followers_count,media_count,profile_picture_url&access_token=${longToken}`
    );
    const prof = await profRes.json();
    const nome = '@' + (prof.username || igUserId);
    const meta = {
      ig_id: prof.user_id || igUserId,   // id da conta profissional (via `user_id` do /me — mesma fonte que meta-token.js já usa) — usado nas chamadas e no entry.id do webhook
      // user_id da troca de token (o que era gravado como ig_id antes da rodada "Inscrição no
      // webhook") — gravado como TEXTO: hoje entra como número no JSON da Meta e, sendo um id de
      // até 17 dígitos, passa do limite de inteiro seguro do JS (Number.MAX_SAFE_INTEGER, ~16
      // dígitos) e nasce arredondado assim que `res.json()` faz o parse (achado real de 28/set/2026:
      // as duas conexões de teste mostraram isso — em @metodo_jump_os os dois ids saíram idênticos,
      // em @joao_vittor divergiram só no último dígito, …439 vs …440). `String(...)` aqui não
      // recupera um dígito já perdido no parse — mas trava o valor como texto daqui pra frente, sem
      // deixar um número (sujeito a virar `17841406338772440e0` ou perder dígito de novo) sobreviver
      // em nenhuma comparação ou gravação posterior.
      ig_app_id: String(igUserId),
      ig_username: prof.username || '',
      ig_name: prof.name || '',
      ig_followers: prof.followers_count || 0,
      ig_media: prof.media_count || 0,
      token_expira_em: tokenExpiraEm,   // ← NOVO: para a renovação automática
      via: 'oauth',
    };
    if (!prof.username || !prof.user_id) {
      // perfil não veio como esperado (mesmo caso da conexão atual, @<id numérico>) — registra o
      // motivo cru para diagnóstico, sem criar UI nova (ver "Reportar" da ordem). Cobre também o
      // caso em que só `user_id` falta: ig_id cai no fallback (igual a ig_app_id) e isso não pode
      // passar em silêncio, mesmo que username tenha vindo.
      meta.perfil_erro = (prof.error && (prof.error.message || JSON.stringify(prof.error))) || `resposta de /me incompleta (username=${JSON.stringify(prof.username)}, user_id=${JSON.stringify(prof.user_id)}): ${JSON.stringify(prof).slice(0, 300)}`;
    }
    // ── ANTI-PIRATARIA: uma conta Instagram = uma conta JUMP ────────────────────
    // E-mail é grátis e infinito; conta Instagram Business com seguidores, não.
    // Como o JUMP só entrega valor com o perfil conectado, essa é a trava natural
    // contra quem cicla e-mails para repetir o teste. Também evita a conexão dupla
    // acidental. Caso legítimo de migração: o admin remove a conexão antiga.
    // Casa por ig_id OU ig_app_id: conexões antigas só têm o id antigo gravado sob a chave ig_id;
    // conexões novas têm os dois. Sem o OR, um mesmo Instagram já conectado antes desta rodada
    // passaria pela trava usando o novo ig_id (diferente do valor antigo gravado).
    const igId = String(meta.ig_id || '');
    const igAppId = String(meta.ig_app_id || '');
    if (igId || igAppId) {
      try {
        const condicoes = [];
        if (igId) condicoes.push(`meta->>ig_id.eq.${encodeURIComponent(igId)}`);
        if (igAppId) condicoes.push(`meta->>ig_app_id.eq.${encodeURIComponent(igAppId)}`);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&or=(${condicoes.join(',')})&user_id=neq.${uid}&select=user_id&limit=1`, { headers: SBH() });
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
          console.warn('ig ja vinculado a outra conta:', igId || igAppId, '->', j[0].user_id);
          return volta('erro=instagram_ja_vinculado');
        }
      } catch (e) { /* falha de checagem não pode impedir uma conexão legítima */ }
    }

    // 4. Salvar conexão
    await sbDel('contas_conectadas', `user_id=eq.${uid}&tipo=eq.instagram`);
    await sbIns('contas_conectadas', {
      user_id: uid, tipo: 'instagram', nome, token: longToken, meta,
    });

    // 5. Inscrever a conta no webhook (comentários + DMs) — evento de CONEXÃO, não rotina do cron
    // (Decisão da ordem: no cron rodaria todo dia sem necessidade e escondia a falha do usuário
    // que acabou de conectar). Sem isso a Meta nunca envia nada, mesmo com o webhook configurado
    // no painel do app — cada conta profissional precisa se inscrever individualmente.
    // Falha aqui NÃO cancela a conexão já salva no passo 4.
    // Inscreve em /me/subscribed_apps (não em /<ig_id>/subscribed_apps): o `me` resolve pelo
    // próprio token e deixa a inscrição independente de qual id foi gravado em ig_id — se o id
    // estiver errado por algum motivo, o problema fica isolado no envio (wEnviar/entry.id), não
    // derruba também a inscrição (ver "Correção do id do perfil no callback do Instagram", 28/set/2026).
    const camposWebhook = 'comments,messages';
    let webhookInscrito = false, webhookErro = '';
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/${IG_API_V}/me/subscribed_apps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ subscribed_fields: camposWebhook, access_token: longToken }),
        }
      );
      const subTxt = await subRes.text();
      if (subRes.ok) {
        let subJson = {};
        try { subJson = JSON.parse(subTxt); } catch (e) {}
        webhookInscrito = subJson.success !== false;
        if (!webhookInscrito) webhookErro = subTxt.slice(0, 300);
      } else {
        webhookErro = subTxt.slice(0, 300);
      }
    } catch (e) {
      webhookErro = String(e.message || e).slice(0, 300);
    }
    await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${uid}&tipo=eq.instagram`, {
      method: 'PATCH', headers: SBH(),
      body: JSON.stringify({
        meta: {
          ...meta,
          webhook_inscrito: webhookInscrito,
          webhook_campos: camposWebhook,
          ...(webhookErro ? { webhook_erro: webhookErro } : {}),
        },
      }),
    }).catch(() => {});

    return volta(webhookInscrito ? 'conectado=instagram' : 'conectado=instagram&webhook=falhou');
  } catch (e) {
    console.error('meta-callback:', e.message);
    return volta('erro=interno&msg=' + encodeURIComponent(e.message.slice(0, 80)));
  }
};
