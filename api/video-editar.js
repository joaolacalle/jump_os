// api/video-editar.js — Editor de Vídeo (ZapCap) com legenda viral automática
// Fluxo ZapCap: upload (URL do Supabase) → task (legenda PT + cortar silêncio) → poll → downloadUrl.
// ENV: ZAPCAP_API_KEY, ZAPCAP_TEMPLATE_ID (opcional), SUPABASE_SERVICE_KEY, SITE_URL
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const { zapUpload, zapCriarTask, montarEdit, iniciarRender } = require('./_video-lib');

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
  if (!process.env.ZAPCAP_API_KEY && !process.env.SHOTSTACK_API_KEY) return res.status(500).json({ error: 'Editor de vídeo não configurado (falta a chave do ZapCap/Shotstack).' });

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

    // ── FLUXO HÍBRIDO: Shotstack (composição) → ZapCap (legenda + corte silêncio) ──
    // Shotstack: composição visual (trilha, filtro, logo, melhoria de áudio).
    // Shotstack faz composição visual. Separamos FILTRO (afeta a imagem/legenda) do resto.
    const temFiltro = !!ops.filtro;
    const temComposicao = !!(ops.trilha_estilo || ops.trilha_url || ops.logo_url || ops.melhorar_voz);
    const precisaShotstack = temFiltro || temComposicao;
    const precisaZapcap = !!(ops.legenda || ops.cortar_silencio);

    // ORDEM INTELIGENTE:
    // - COM filtro + legenda: Shotstack PRIMEIRO (o filtro é aplicado antes; a legenda é
    //   queimada depois, limpa, com a cor exata escolhida). fase2:zapcap
    // - SEM filtro, mas com legenda/corte + composição (trilha/logo/áudio): ZapCap PRIMEIRO
    //   (corta o silêncio → vídeo menor → Shotstack processa menos = ECONOMIZA). fase2:shot
    // - Só um dos dois: direto.

    const temZap = !!process.env.ZAPCAP_API_KEY;
    const temShot = !!process.env.SHOTSTACK_API_KEY;

    async function iniciarPorShotstack(fase2) {
      const edit = montarEdit(origem_url, ops, null);
      const rn = await iniciarRender(edit);
      if (rn.error) return { error: 'Falha ao compor o vídeo: ' + rn.error };
      const job = await sbInsert('video_jobs', {
        user_id: alvoId, status: 'processando', origem_url, operacoes: ops,
        titulo: titulo || 'Vídeo', render_id: 'shot:' + rn.render_id,
        salvo_path: fase2 ? 'fase2:zapcap' : null,
      });
      return { jobId: Array.isArray(job) && job[0] ? job[0].id : null };
    }
    async function iniciarPorZapcap(fase2) {
      const up = await zapUpload(origem_url);
      if (up.error) return { error: 'Falha ao enviar o vídeo: ' + up.error };
      const tk = await zapCriarTask(up.videoId, ops);
      if (tk.error) return { error: 'Falha ao processar: ' + tk.error };
      const job = await sbInsert('video_jobs', {
        user_id: alvoId, status: 'processando', origem_url, operacoes: ops,
        titulo: titulo || 'Vídeo', render_id: 'zap:' + up.videoId + ':' + tk.taskId,
        salvo_path: fase2 ? 'fase2:shot' : null,
      });
      return { jobId: Array.isArray(job) && job[0] ? job[0].id : null };
    }

    let out;
    // CASO A: precisa dos dois
    if (precisaShotstack && precisaZapcap && temShot && temZap) {
      // com filtro → Shotstack 1º (protege legenda). sem filtro → ZapCap 1º (economiza).
      out = temFiltro ? await iniciarPorShotstack(true) : await iniciarPorZapcap(true);
    }
    // CASO B: só Shotstack
    else if (precisaShotstack && temShot) {
      out = await iniciarPorShotstack(false);
    }
    // CASO C: só ZapCap (inclui: pediu composição mas a chave do Shotstack falta → processa a legenda e AVISA)
    else if (precisaZapcap && temZap) {
      out = await iniciarPorZapcap(false);
      if (out && !out.error && precisaShotstack && !temShot) {
        out.aviso = 'Legenda/corte em andamento. Trilha, filtro e logo NÃO foram aplicados: a chave do Shotstack não está configurada (avise o administrador).';
      }
    }
    // Pediu SÓ composição (trilha/filtro/logo) e o Shotstack não está configurado → erro claro, não silêncio
    else if (precisaShotstack && !temShot) {
      return res.status(500).json({ error: 'Trilha, filtro e logo exigem a chave do Shotstack (SHOTSTACK_API_KEY), que não está configurada na Vercel.' });
    }
    if (out) {
      if (out.error) return res.status(502).json({ error: out.error });
      return res.status(200).json({ ok: true, job_id: out.jobId, status: 'processando', aviso: out.aviso || null });
    }

    // Nenhuma opção que exija processamento (ex: só quer o vídeo como está) — não deveria ocorrer
    return res.status(400).json({ error: 'Selecione ao menos uma opção de edição.' });
  } catch (e) {
    console.error('video-editar error:', e.message);
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
};
