// api/meta-webhook.js — Webhook do Instagram (comentários + mensagens diretas) → automação de DM.
//   GET  = verificação da Meta (hub.challenge).
//   POST = eventos: casa a PALAVRA-CHAVE com as regras (automacoes_dm) e responde por DM.
// A assinatura dos webhooks é feita no PAINEL do app da Meta (callback + verify token + campos
// instagram: comments, messages) — cobre todas as contas conectadas. Nada de novo no banco:
// o contador de envios vive em clientes.uso.dm_envios (jsonb).
// ENV: META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET, SUPABASE_SERVICE_KEY
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({ 'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`, 'Content-Type': 'application/json' });
const IG_V = 'v19.0'; // mesma versão do resto do projeto (graph.instagram.com); bump é 1 linha se a Meta pedir.
const LIMS_DM = { basico: 0, plus: 100, pro: 300 };

// normaliza p/ casar palavra-chave sem depender de acento/caixa
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// conta conectada que recebeu o evento (pelo ig_id)
async function contaPorIg(igId) {
  const arr = await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&meta->>ig_id=eq.${encodeURIComponent(igId)}&select=user_id,token,meta`, { headers: SBH() }).then(r => r.json()).catch(() => []);
  return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
}
// regras ativas do usuário
async function regrasDe(uid) {
  const arr = await fetch(`${SUPABASE_URL}/rest/v1/automacoes_dm?user_id=eq.${uid}&ativo=eq.true&select=palavra_chave,mensagem,gatilho,origem`, { headers: SBH() }).then(r => r.json()).catch(() => []);
  return Array.isArray(arr) ? arr : [];
}
// primeira regra cujo gatilho e palavra-chave batem com o texto
function casar(texto, regras, gatilho) {
  const t = norm(texto);
  return regras.find(r => {
    const g = String(r.gatilho || 'ambos');
    if (g !== 'ambos' && g !== gatilho) return false;
    if (r.origem === 'anuncio') return false; // v1: sem distinguir mídia de anúncio; atende organico|ambos
    const kw = norm(r.palavra_chave);
    return kw && t.includes(kw);
  });
}
// cota mensal de envios (uso.dm_envios vs plano)
async function checarCota(uid) {
  const cli = (await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${uid}&select=id,plano,limites,uso`, { headers: SBH() }).then(r => r.json()).catch(() => []))[0];
  if (!cli) return { ok: false };
  const lim = Number((cli.limites && cli.limites.dm_envios) != null ? cli.limites.dm_envios : (LIMS_DM[cli.plano] || 0));
  const usados = Number((cli.uso && cli.uso.dm_envios) || 0);
  return { ok: usados < lim, cli };
}
async function debitar(cli) {
  const uso = Object.assign({}, cli.uso || {}, { dm_envios: Number((cli.uso && cli.uso.dm_envios) || 0) + 1 });
  await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${cli.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) }).catch(() => {});
}
// envia: DM direto (recipient.id) ou private reply de comentário (recipient.comment_id)
async function enviarResposta(igId, token, recipient, texto) {
  const r = await fetch(`https://graph.instagram.com/${IG_V}/${igId}/messages`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, message: { text: String(texto || '').slice(0, 900) } }),
  });
  return r.ok;
}

module.exports = async (req, res) => {
  // 1) VERIFICAÇÃO (GET) — a Meta confirma a URL do webhook
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && q['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(q['hub.challenge']);
    }
    return res.status(403).json({ error: 'verify_token inválido' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não suportado' });

  // 2) EVENTOS (POST)
  try {
    let raw = '';
    await new Promise((ok) => { req.on('data', d => raw += d); req.on('end', ok); });
    // valida a assinatura X-Hub-Signature-256 (se presente) com o segredo do app
    try {
      const sig = String(req.headers['x-hub-signature-256'] || '');
      if (sig && process.env.META_APP_SECRET) {
        const crypto = require('crypto');
        const esperado = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
        if (sig !== esperado) return res.status(401).json({ error: 'assinatura inválida' });
      }
    } catch (e) {}
    const body = raw ? JSON.parse(raw) : (req.body || {});
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const ent of entries) {
      const igId = String(ent.id || '');
      if (!igId) continue;
      const conta = await contaPorIg(igId);
      if (!conta || !conta.token) continue;
      const regras = await regrasDe(conta.user_id);
      if (!regras.length) continue;

      // 2a) COMENTÁRIOS → private reply (uma por comentário, para sempre)
      for (const ch of (Array.isArray(ent.changes) ? ent.changes : [])) {
        if (ch.field !== 'comments') continue;
        const v = ch.value || {};
        const texto = v.text || '', commentId = v.id;
        // ignora comentários do próprio dono da conta
        if (v.from && String(v.from.id) === igId) continue;
        const regra = casar(texto, regras, 'comentario');
        if (!regra || !commentId) continue;
        const cota = await checarCota(conta.user_id);
        if (!cota.ok) continue;
        if (await enviarResposta(igId, conta.token, { comment_id: commentId }, regra.mensagem)) await debitar(cota.cli);
      }

      // 2b) MENSAGENS DIRETAS → resposta na conversa (janela de 24h aberta pela msg do usuário)
      for (const mg of (Array.isArray(ent.messaging) ? ent.messaging : [])) {
        if (mg.message && mg.message.is_echo) continue; // não reage à própria mensagem
        const senderId = mg.sender && mg.sender.id;
        const texto = (mg.message && mg.message.text) || '';
        if (!senderId || !texto || String(senderId) === igId) continue;
        const regra = casar(texto, regras, 'dm');
        if (!regra) continue;
        const cota = await checarCota(conta.user_id);
        if (!cota.ok) continue;
        if (await enviarResposta(igId, conta.token, { id: senderId }, regra.mensagem)) await debitar(cota.cli);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('meta-webhook:', e.message);
    return res.status(200).json({ ok: true }); // nunca falhar o handshake da Meta
  }
};
