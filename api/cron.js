// api/cron.js — Crons consolidados (estratégia + renovação de tokens em 1 função)
// Resolve o limite de funções da Vercel. Decide o job por ?job=
//   ?job=estrategia → cria aviso "Estratégia do mês pronta" (dia 25)
//   ?job=tokens     → renova tokens da Meta que expiram em < 10 dias (diário)
// Protegido por CRON_SECRET.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// ── JOB 1: aviso de estratégia mensal (dia 25) ──
async function jobEstrategia() {
  const agora = new Date();
  const proxIdx = (agora.getMonth() + 1) % 12;
  const mesProx = MESES[proxIdx];
  const tagMes = `estrategia_${agora.getFullYear()}_${proxIdx}`;
  const clientes = await fetch(
    `${SUPABASE_URL}/rest/v1/clientes?status=eq.ativo&select=id,nome,plano`, { headers: SBH() }
  ).then(r => r.json());
  if (!Array.isArray(clientes)) return { avisos: 0 };
  let criados = 0;
  for (const c of clientes) {
    const existe = await fetch(
      `${SUPABASE_URL}/rest/v1/recados?user_id=eq.${c.id}&titulo=eq.${encodeURIComponent('Estratégia do mês pronta')}&mensagem=like=*${tagMes}*&select=id&limit=1`,
      { headers: SBH() }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existe) && existe.length) continue;
    await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({
        user_id: c.id, tipo: 'info',
        titulo: 'Estratégia do mês pronta',
        mensagem: `Chegou a hora de planejar ${mesProx}! Abra o Agente de Estratégia e clique em "Gerar estratégia do mês" para receber seu plano, revisar e aprovar. [${tagMes}]`,
        lido: false, resolvido: false,
      }),
    }).catch(() => {});
    criados++;
  }
  return { mes: mesProx, avisos: criados };
}

// ── JOB 2: renovação automática de tokens da Meta ──
async function jobTokens() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&select=id,user_id,token,meta`,
    { headers: SBH() }
  );
  const contas = await r.json();
  if (!Array.isArray(contas)) return { renovados: 0 };
  const agora = Date.now();
  const LIMITE_MS = 10 * 24 * 3600 * 1000;
  let renovados = 0, expirados = 0, ok = 0;
  for (const c of contas) {
    const meta = c.meta || {};
    const expEm = meta.token_expira_em ? new Date(meta.token_expira_em).getTime() : 0;
    const restante = expEm - agora;
    if (expEm && restante <= 0) {
      expirados++;
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?id=eq.${c.id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ meta: { ...meta, token_status: 'expirado' } }),
      }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
        method: 'POST', headers: SBH(),
        body: JSON.stringify({
          user_id: c.user_id, tipo: 'alerta',
          titulo: 'Reconecte seu Instagram',
          mensagem: 'A conexão com o Instagram expirou. Acesse "Conectar contas" e reconecte para os agentes voltarem a publicar e ler métricas.',
          lido: false, resolvido: false,
        }),
      }).catch(() => {});
      continue;
    }
    if (expEm && restante < LIMITE_MS) {
      try {
        const rr = await fetch(
          `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${c.token}`
        );
        const t = await rr.json();
        if (t.access_token) {
          const expiraSeg = Number(t.expires_in) || (60 * 24 * 3600);
          const novaExp = new Date(agora + expiraSeg * 1000).toISOString();
          await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?id=eq.${c.id}`, {
            method: 'PATCH', headers: SBH(),
            body: JSON.stringify({ token: t.access_token, meta: { ...meta, token_expira_em: novaExp, token_status: 'ok' } }),
          }).catch(() => {});
          renovados++;
        }
      } catch (e) {}
    } else { ok++; }
  }
  return { total: contas.length, renovados, expirados, saudaveis: ok };
}

module.exports = async (req, res) => {
  // Segurança: só executa com o segredo certo
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'não autorizado' });
  }
  const job = (req.query && req.query.job) || '';
  try {
    if (job === 'estrategia') {
      const r = await jobEstrategia();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'tokens') {
      const r = await jobTokens();
      return res.status(200).json({ ok: true, job, ...r });
    }
    return res.status(400).json({ error: 'job inválido (use ?job=estrategia ou ?job=tokens)' });
  } catch (e) {
    console.error('cron:', e.message);
    return res.status(500).json({ error: 'falha no cron', job });
  }
};
