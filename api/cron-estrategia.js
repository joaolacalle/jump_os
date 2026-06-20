// api/cron-estrategia.js — Gatilho mensal (dia 25)
// Cria um aviso na dashboard de cada cliente ATIVO para gerar a estratégia do mês seguinte.
// Chamado pelo Vercel Cron (ver vercel.json). Geração real é sob demanda (cliente clica).
// Protegido por CRON_SECRET (ENV) para não ser disparado por terceiros.

const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const H = () => ({
  'apikey': KEY(),
  'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

export default async function handler(req, res) {
  // Segurança: só executa com o segredo certo (Vercel Cron envia no header Authorization)
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  try {
    const agora = new Date();
    const proxIdx = (agora.getMonth() + 1) % 12;
    const mesProx = MESES[proxIdx];
    const tagMes = `estrategia_${agora.getFullYear()}_${proxIdx}`; // evita duplicar no mesmo ciclo

    // Clientes ativos (status ativo) — são quem recebe o aviso
    const clientes = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes?status=eq.ativo&select=id,nome,plano`,
      { headers: H() }
    ).then(r => r.json());

    if (!Array.isArray(clientes)) return res.status(200).json({ ok: true, avisos: 0 });

    let criados = 0;
    for (const c of clientes) {
      // Já existe aviso deste ciclo para este cliente? (não duplicar)
      const existe = await fetch(
        `${SUPABASE_URL}/rest/v1/recados?user_id=eq.${c.id}&titulo=eq.${encodeURIComponent('Estratégia do mês pronta')}&mensagem=like=*${tagMes}*&select=id&limit=1`,
        { headers: H() }
      ).then(r => r.json()).catch(() => []);
      if (Array.isArray(existe) && existe.length) continue;

      await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
        method: 'POST', headers: H(),
        body: JSON.stringify({
          user_id: c.id,
          tipo: 'info',
          titulo: 'Estratégia do mês pronta',
          mensagem: `Chegou a hora de planejar ${mesProx}! Abra o Agente de Estratégia e clique em "Gerar estratégia do mês" para receber seu plano completo, revisar e aprovar. [${tagMes}]`,
          lido: false, resolvido: false,
        }),
      }).catch(() => {});
      criados++;
    }

    return res.status(200).json({ ok: true, mes: mesProx, avisos: criados });
  } catch (e) {
    console.error('cron-estrategia:', e);
    return res.status(500).json({ error: 'falha no cron' });
  }
}
