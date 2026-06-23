// api/cron-renovar-tokens.js — Renovação automática dos tokens da Meta (Instagram)
// Roda diariamente (Vercel Cron). Renova tokens que expiram em < 10 dias,
// mantendo o ciclo de 60 dias sem interrupção. Protegido por CRON_SECRET.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});

module.exports = async (req, res) => {
  // Segurança: só executa com o segredo certo (Vercel Cron envia no header)
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  try {
    // Busca todas as conexões de Instagram
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&select=id,user_id,token,meta`,
      { headers: SBH() }
    );
    const contas = await r.json();
    if (!Array.isArray(contas)) return res.status(200).json({ ok: true, renovados: 0 });

    const agora = Date.now();
    const LIMITE_MS = 10 * 24 * 3600 * 1000; // renova se faltar menos de 10 dias
    let renovados = 0, expirados = 0, ok = 0;

    for (const c of contas) {
      const meta = c.meta || {};
      const expEm = meta.token_expira_em ? new Date(meta.token_expira_em).getTime() : 0;
      const restante = expEm - agora;

      // Já expirou (ou sem data) → marca para reconectar e avisa o usuário
      if (expEm && restante <= 0) {
        expirados++;
        await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?id=eq.${c.id}`, {
          method: 'PATCH', headers: SBH(),
          body: JSON.stringify({ meta: { ...meta, token_status: 'expirado' } }),
        }).catch(() => {});
        // aviso no painel do cliente
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

      // Ainda válido, mas perto de expirar → renova (+60 dias)
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
              body: JSON.stringify({
                token: t.access_token,
                meta: { ...meta, token_expira_em: novaExp, token_status: 'ok' },
              }),
            }).catch(() => {});
            renovados++;
          }
        } catch (e) { /* tenta de novo no próximo dia */ }
      } else {
        ok++;
      }
    }

    return res.status(200).json({ ok: true, total: contas.length, renovados, expirados, saudaveis: ok });
  } catch (e) {
    console.error('cron-renovar-tokens:', e.message);
    return res.status(500).json({ error: 'falha na renovação' });
  }
};
