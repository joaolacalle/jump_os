// api/video-editar.js — Editor de Vídeo (ZapCap) com legenda viral automática
// Fluxo ZapCap: upload (URL do Supabase) → task (legenda PT + cortar silêncio) → poll → downloadUrl.
// ENV: ZAPCAP_API_KEY, ZAPCAP_TEMPLATE_ID (opcional), SUPABASE_SERVICE_KEY, SITE_URL
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const { zapUpload, zapCriarTask } = require('./_video-lib');

function H() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
}
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H() });
  return r.json();
}
async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...H(), Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  return r.json();
}
async function sbPatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!process.env.SHOTSTACK_API_KEY) return res.status(500).json({ error: 'Editor de vídeo não configurado (falta a chave do Shotstack).' });

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Não autenticado: token ausente. Recarregue a página e entre de novo.' });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    const user = await uRes.json();
    if (!uRes.ok || !user.id) return res.status(401).json({ error: 'Não autenticado: sessão inválida ou expirada (HTTP ' + uRes.status + '). Saia e entre de novo.' });

    const { origem_url, operacoes, titulo, ver_id, guardar_estilo } = req.body;
    if (!origem_url) return res.status(400).json({ error: 'Envie o vídeo primeiro.' });
    const ops = operacoes || {};

    let alvoId = user.id;
    if (ver_id && ver_id !== user.id) {
      const [me] = await sbGet(`clientes?id=eq.${user.id}&select=role`);
      if (me && (me.role === 'admin' || me.role === 'supervisor')) alvoId = ver_id;
    }

    if (guardar_estilo) {
      const ups = [];
      if (ops.legenda_fonte) ups.push({ chave: 'video_estilo_legenda', valor: `fonte ${ops.legenda_fonte}, cor ${ops.legenda_cor || '#fff'}` });
      if (ops.estilo_corte != null) ups.push({ chave: 'video_corte_preferido', valor: ops.estilo_corte || 'corte seco' });
      if (ops.formato) ups.push({ chave: 'video_formato_padrao', valor: ops.formato });
      for (const m of ups) {
        await fetch(`${SUPABASE_URL}/rest/v1/memorias`, {
          method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ user_id: alvoId, agente: 'global', chave: m.chave, valor: m.valor, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    const [cli] = await sbGet(`clientes?id=eq.${alvoId}&select=plano,limites,uso,bloqueado,role`);
    if (!cli) return res.status(404).json({ error: 'Conta não encontrada' });
    if (cli.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });
    if (cli.role === 'usuario') {
      const mes = new Date().toISOString().slice(0, 7);
      let uso = cli.uso || {};
      if (uso.mes !== mes) uso = { tokens: 0, imagens: 0, reloads: 0, videos: 0, mes };
      const limVideos = Number((cli.limites && cli.limites.videos) ?? 0);
      if (Number(uso.videos || 0) >= limVideos) {
        return res.status(403).json({ error: `Você atingiu o limite de ${limVideos} vídeo(s) do seu plano este mês.` });
      }
      uso.videos = Number(uso.videos || 0) + 1;
      await sbPatch(`clientes?id=eq.${alvoId}`, { uso });
    }

    // ── FLUXO ZAPCAP: upload → task (legenda PT + cortar silêncio + b-roll) ──
    // 1. Envia a URL do vídeo (nosso Supabase) pro ZapCap
    const up = await zapUpload(origem_url);
    if (up.error) return res.status(502).json({ error: 'Falha ao enviar o vídeo: ' + up.error });

    // 2. Cria a task de edição/legenda
    const tk = await zapCriarTask(up.videoId, ops);
    if (tk.error) return res.status(502).json({ error: 'Falha ao processar: ' + tk.error });

    // 3. Guarda o job (videoId + taskId no render_id, separados por :)
    const job = await sbInsert('video_jobs', {
      user_id: alvoId, status: 'processando', origem_url, operacoes: ops,
      titulo: titulo || 'Vídeo', render_id: 'zap:' + up.videoId + ':' + tk.taskId,
    });
    const jobId = Array.isArray(job) && job[0] ? job[0].id : null;
    return res.status(200).json({ ok: true, job_id: jobId, status: 'processando' });
  } catch (e) {
    console.error('video-editar error:', e.message);
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
};
