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
    // Instagram assina com a chave do app do Instagram; o login do Facebook (Meta Ads), com a do
    // app — aceita qualquer uma das duas (iguais quando META_FB_APP_SECRET não está definida).
    const segredos = [...new Set([process.env.META_APP_SECRET, process.env.META_FB_APP_SECRET].filter(Boolean))];
    const assinaturaOk = segredos.some(seg => crypto.createHmac('sha256', seg).update(payload).digest('base64url') === sig);
    if (!assinaturaOk) return res.status(401).json({ error: 'assinatura inválida' });
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const igUser = String(dados.user_id || '');
    if (igUser) {
      // Login do Facebook (Meta Ads): o user_id do signed_request é o id do usuário do Facebook
      // no app — apaga a conexão de Ads gravada com esse fb_user_id.
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.ads&meta->>fb_user_id=eq.${encodeURIComponent(igUser)}`, {
        method: 'DELETE', headers: SBH(),
      }).catch(() => {});
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

// ── META ADS (02/out/2026, Agente de Tráfego — fase 1, só leitura) ──────────────────────────
// Login do Facebook: code → token curto → token longo (60 dias, NÃO renovável sozinho: perto de
// vencer, o cron avisa o cliente para reconectar). Confere se ads_read foi mesmo concedido (o
// cliente pode desmarcar na tela da Meta), lista as contas de anúncio e grava a conexão
// tipo='ads'. Com 1 conta ativa, já escolhe; com várias, a tela pede para o cliente escolher.
async function conectarAds({ code, uid, aceiteEm, volta }) {
  const ADS = require('./_ads-lib.js');
  if (!aceiteEm) return volta('erro=aceite_ausente');
  const t1 = await fetch(`${ADS.GRAPH}/oauth/access_token?` + new URLSearchParams({
    client_id: ADS.fbAppId(), client_secret: ADS.fbAppSecret(), redirect_uri: REDIRECT, code,
  })).then(r => r.json()).catch(() => ({}));
  if (!t1.access_token) {
    console.error('ads token curto:', JSON.stringify(t1).slice(0, 300));
    return volta('erro=token');
  }
  const t2 = await fetch(`${ADS.GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: ADS.fbAppId(), client_secret: ADS.fbAppSecret(), fb_exchange_token: t1.access_token,
  })).then(r => r.json()).catch(() => ({}));
  const token = t2.access_token || t1.access_token;
  const expiraSeg = Number(t2.expires_in) || (60 * 24 * 3600);
  const tokenExpiraEm = new Date(Date.now() + expiraSeg * 1000).toISOString();

  let fbUserId = '', concedidas = [];
  try {
    const me = await ADS.graphGet('me', { fields: 'id' }, token);
    fbUserId = String(me.id || '');
    const perms = await ADS.graphGet('me/permissions', {}, token);
    concedidas = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
  } catch (e) {
    console.error('ads me/permissions:', e.message);
    return volta('erro=token');
  }
  if (!concedidas.includes('ads_read')) return volta('erro=permissao_ads');

  let contas = [];
  try { contas = await ADS.listarContas(token); }
  catch (e) { console.error('ads adaccounts:', e.message); return volta('erro=token'); }
  if (!contas.length) return volta('erro=sem_conta_ads');
  const ativas = contas.filter(c => c.status === 1);
  const escolhida = contas.length === 1 ? contas[0] : (ativas.length === 1 ? ativas[0] : null);

  const meta = {
    fb_user_id: fbUserId,
    contas_ads: contas,
    ad_account_id: escolhida ? escolhida.id : null,
    ad_account_nome: escolhida ? escolhida.nome : '',
    moeda: escolhida ? escolhida.moeda : '',
    fuso: escolhida ? escolhida.fuso : '',
    escopos: concedidas,
    token_expira_em: tokenExpiraEm,
    aceite_responsabilidade_em: aceiteEm,
    aceite_texto: 'Ativar campanhas e definir orçamento são decisões minhas, feitas no meu Gerenciador de Anúncios. O JUMP lê os números e prepara recomendações; nunca ativa campanha nem altera orçamento.',
    via: 'oauth',
  };
  await sbDel('contas_conectadas', `user_id=eq.${uid}&tipo=eq.ads`);
  await sbIns('contas_conectadas', {
    user_id: uid, tipo: 'ads', nome: escolhida ? escolhida.nome : 'Meta Ads', token, meta,
  });
  return volta(escolhida ? 'conectado=ads' : 'conectado=ads&escolher=1');
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
    // STATE ASSINADO (29/set/2026, "Meta OAuth — assinar o state e validar no callback"): antes,
    // state era só base64url(`uid|tipo`), sem assinatura nem prazo — qualquer um montava a URL de
    // autorização na mão (client_id/redirect_uri são públicos) com o uid de outra pessoa e este
    // callback apagava e sobrescrevia a conexão legítima da vítima (~163, abaixo). Agora o state
    // vem como `<payload-base64url>.<assinatura>`, payload = `uid|tipo|exp` (exp em
    // epoch-segundos). Recalcula a assinatura com o MESMO segredo/encoding de api/meta-oauth.js e
    // compara por tempo constante (crypto.timingSafeEqual) — nunca com `===`, que vaza tempo de
    // comparação por byte. Qualquer coisa fora do esperado (formato antigo sem `.`, assinatura
    // adulterada, uid trocado com a assinatura de outro payload, ou state vencido) cai no mesmo
    // erro genérico, ANTES de qualquer chamada à Meta — nunca loga a assinatura em si, só o
    // motivo, pra não deixar nem um fiapo dela em log nenhum.
    let uid, tipo, aceiteEm = '';
    try {
      const crypto = require('crypto');
      const partes = String(state).split('.');
      if (partes.length !== 2 || !partes[0] || !partes[1]) throw new Error('formato');
      const [payload, assinatura] = partes;
      if (!process.env.META_APP_SECRET) throw new Error('sem-segredo');
      const esperada = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('base64url');
      const assBuf = Buffer.from(assinatura);
      const espBuf = Buffer.from(esperada);
      if (assBuf.length !== espBuf.length || !crypto.timingSafeEqual(assBuf, espBuf)) throw new Error('assinatura');
      const [uidP, tipoP, expP, aceiteP] = Buffer.from(payload, 'base64url').toString().split('|');
      const exp = Number(expP);
      if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) throw new Error('vencido');
      if (!uidP) throw new Error('uid-ausente');
      uid = uidP; tipo = tipoP;
      if (aceiteP && Number.isFinite(Number(aceiteP))) aceiteEm = new Date(Number(aceiteP) * 1000).toISOString();
    } catch (e) {
      console.error('meta-callback: state recusado —', e.message);
      return volta('erro=estado_invalido');
    }
    // Meta Ads usa o login do Facebook — fluxo de token totalmente diferente do Instagram.
    if (tipo === 'ads') return await conectarAds({ code, uid, aceiteEm, volta });
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
    // ── VÍNCULO PERMANENTE (03/out/2026) ─────────────────────────────────────────
    // A checagem acima só enxerga conexões ATIVAS: desconectar o Instagram ou excluir a conta
    // liberava o @ para um e-mail novo. instagram_vinculos guarda o primeiro dono para sempre
    // (não é apagada na desconexão nem na exclusão). Só o suporte libera (liberado_em).
    if (igId || igAppId) {
      let vinculos = null;
      try {
        const condicoes = [];
        if (igId) condicoes.push(`ig_id.eq.${encodeURIComponent(igId)}`, `ig_app_id.eq.${encodeURIComponent(igId)}`);
        if (igAppId) condicoes.push(`ig_id.eq.${encodeURIComponent(igAppId)}`, `ig_app_id.eq.${encodeURIComponent(igAppId)}`);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/instagram_vinculos?or=(${condicoes.join(',')})&select=id,user_id,liberado_em`, { headers: SBH() });
        if (r.ok) vinculos = await r.json();
        else console.error('[meta-callback] vínculo: leitura falhou status=' + r.status);
      } catch (e) { console.error('[meta-callback] vínculo: leitura exceção', e && e.message); }
      if (Array.isArray(vinculos)) {
        const deOutro = vinculos.find(v => v.user_id !== uid && !v.liberado_em);
        if (deOutro) {
          console.warn('ig com vínculo permanente de outra conta:', igId || igAppId, '->', deOutro.user_id);
          return volta('erro=instagram_ja_vinculado');
        }
        if (!vinculos.some(v => v.user_id === uid && !v.liberado_em)) {
          let email = null;
          try {
            const cl = await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${uid}&select=email`, { headers: SBH() }).then(x => x.json());
            email = (Array.isArray(cl) && cl[0] && cl[0].email) || null;
          } catch (e) {}
          const w = await fetch(`${SUPABASE_URL}/rest/v1/instagram_vinculos`, {
            method: 'POST', headers: SBH(),
            body: JSON.stringify({ ig_id: igId || null, ig_app_id: igAppId || null, ig_username: meta.ig_username || null, user_id: uid, email }),
          }).catch(e => ({ ok: false, status: String(e && e.message) }));
          if (!w.ok) console.error('[meta-callback] vínculo: gravação falhou status=' + w.status);
        }
      }
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
