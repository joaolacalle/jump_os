// api/video-editar.js — dispara a edição de vídeo no Shotstack (assíncrono)
// ENV: SHOTSTACK_API_KEY, SHOTSTACK_ENV (stage|v1), SUPABASE_SERVICE_KEY, SITE_URL
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

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

// Monta o "edit" do Shotstack conforme as operações pedidas
function montarEdit(origemUrl, ops) {
  const largura = ops.formato === 'reels' ? 1080 : 1920;
  const altura = ops.formato === 'reels' ? 1920 : 1080;

  // clip principal (vídeo cru), com corte opcional
  const videoClip = {
    asset: { type: 'video', src: origemUrl, volume: 1 },
    start: 0,
    length: ops.fim && ops.inicio != null ? (Number(ops.fim) - Number(ops.inicio)) : 'auto',
  };
  if (ops.inicio != null) videoClip.asset.trim = Number(ops.inicio);

  const tracks = [{ clips: [videoClip] }];

  // overlay de logo (se enviado)
  if (ops.logo_url) {
    tracks.unshift({ clips: [{
      asset: { type: 'image', src: ops.logo_url },
      start: 0, length: 'end',
      offset: { x: 0.35, y: 0.40 }, scale: 0.15, opacity: 0.9,
    }] });
  }

  // texto/título sobreposto (se pedido)
  if (ops.texto) {
    tracks.unshift({ clips: [{
      asset: { type: 'title', text: ops.texto, style: 'minimal', size: 'medium', position: 'top' },
      start: 0, length: ops.texto_duracao ? Number(ops.texto_duracao) : 4,
      transition: { in: 'fade', out: 'fade' },
    }] });
  }

  const timeline = { background: '#000000', tracks };

  // trilha sonora (se enviada)
  if (ops.trilha_url) {
    timeline.soundtrack = { src: ops.trilha_url, effect: 'fadeInFadeOut', volume: ops.trilha_volume ?? 0.3 };
  }

  const edit = {
    timeline,
    output: { format: 'mp4', size: { width: largura, height: altura }, fps: 30 },
  };

  // legendas automáticas: o Shotstack transcreve o áudio do clipe e adiciona
  if (ops.legenda) {
    edit.timeline.tracks.unshift({ clips: [{
      asset: { type: 'caption', src: origemUrl, // transcreve a partir do próprio vídeo
        font: { color: '#ffffff', size: ops.formato === 'reels' ? 42 : 32 },
        background: { color: '#000000', opacity: 0.6, padding: 8, borderRadius: 6 },
      },
      start: 0, length: 'end',
      offset: { y: ops.formato === 'reels' ? -0.25 : -0.40 },
    }] });
  }

  return edit;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Editor de vídeo não configurado (falta a chave do Shotstack).' });

  try {
    // Auth do usuário
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    if (!uRes.ok) return res.status(401).json({ error: 'Não autenticado' });
    const user = await uRes.json();

    const { origem_url, operacoes, titulo } = req.body;
    if (!origem_url) return res.status(400).json({ error: 'Envie o vídeo primeiro.' });
    const ops = operacoes || {};

    // Conta e limite de vídeos
    const [cli] = await sbGet(`clientes?id=eq.${user.id}&select=plano,limites,uso,bloqueado,role`);
    if (!cli) return res.status(404).json({ error: 'Conta não encontrada' });
    if (cli.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });

    // admin/supervisor sem limite; usuário respeita lim.videos
    if (cli.role === 'usuario') {
      const mes = new Date().toISOString().slice(0, 7);
      let uso = cli.uso || {};
      if (uso.mes !== mes) uso = { tokens: 0, imagens: 0, reloads: 0, videos: 0, mes };
      const limVideos = Number((cli.limites && cli.limites.videos) ?? 0);
      if (Number(uso.videos || 0) >= limVideos) {
        return res.status(403).json({ error: `Você atingiu o limite de ${limVideos} vídeo(s) do seu plano este mês.` });
      }
      // incrementa o uso
      uso.videos = Number(uso.videos || 0) + 1;
      await sbPatch(`clientes?id=eq.${user.id}`, { uso });
    }

    // Cria o registro do job
    const job = await sbInsert('video_jobs', {
      user_id: user.id, status: 'processando', origem_url, operacoes: ops, titulo: titulo || 'Vídeo',
    });
    const jobId = Array.isArray(job) && job[0] ? job[0].id : null;

    // Monta o edit e dispara o render no Shotstack
    const edit = montarEdit(origem_url, ops);
    const stage = process.env.SHOTSTACK_ENV || 'stage'; // 'stage' (testes) ou 'v1' (produção)
    const siteUrl = process.env.SITE_URL || 'https://metodojump.com.br';
    edit.callback = `${siteUrl}/api/video-webhook`;

    const sres = await fetch(`https://api.shotstack.io/edit/${stage}/render`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    const sdata = await sres.json();

    if (!sres.ok || !sdata.success) {
      if (jobId) await sbPatch(`video_jobs?id=eq.${jobId}`, { status: 'erro', erro: JSON.stringify(sdata).slice(0, 300) });
      return res.status(502).json({ error: 'Falha ao iniciar a edição do vídeo. Tente novamente.' });
    }

    const renderId = sdata.response && sdata.response.id;
    if (jobId) await sbPatch(`video_jobs?id=eq.${jobId}`, { render_id: renderId });

    return res.status(200).json({ ok: true, job_id: jobId, render_id: renderId, status: 'processando' });
  } catch (e) {
    console.error('video-editar error:', e.message);
    return res.status(500).json({ error: 'Erro interno ao processar o vídeo.' });
  }
};
