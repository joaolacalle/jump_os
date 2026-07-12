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
    `${SUPABASE_URL}/rest/v1/clientes?status=eq.ativo&select=id,nome,plano,tipo_cortesia,cortesia_ate`, { headers: SBH() }
  ).then(r => r.json());
  if (!Array.isArray(clientes)) return { avisos: 0 };
  let criados = 0;
  for (const c of clientes) {
    // pula quem está no período de teste (a estratégia do trial é de 7 dias, não mensal)
    if (c.tipo_cortesia === 'trial' && c.cortesia_ate && new Date(c.cortesia_ate).getTime() > Date.now()) continue;
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

// ── JOB 3: monitoramento de segurança (detecta padrões suspeitos e avisa o admin) ──
async function jobSeguranca() {
  const agora = Date.now();
  const h24 = new Date(agora - 24*3600*1000).toISOString();
  const clientes = await fetch(`${SUPABASE_URL}/rest/v1/clientes?select=id,email,cpf,status,bloqueado,tipo_cortesia,cortesia_ate,created_at,uso`, { headers: SBH() }).then(r=>r.json());
  const arr = Array.isArray(clientes) ? clientes : [];
  const admins = await fetch(`${SUPABASE_URL}/rest/v1/clientes?role=eq.admin&select=id`, { headers: SBH() }).then(r=>r.json());
  const adminIds = Array.isArray(admins) ? admins.map(a=>a.id) : [];
  if (!adminIds.length) return { avisos: 0 };

  const alertas = [];
  // 1) muitas contas novas em 24h
  const novas = arr.filter(c => c.created_at && c.created_at >= h24);
  if (novas.length >= 5) alertas.push(`${novas.length} contas criadas nas últimas 24h — verifique se há cadastros em massa.`);
  // 2) CPF repetido (possível multiconta/abuso)
  const cpfMap = {};
  arr.forEach(c => { if (c.cpf) cpfMap[c.cpf] = (cpfMap[c.cpf]||0)+1; });
  Object.entries(cpfMap).filter(([_,n]) => n > 1).forEach(([cpf,n]) =>
    alertas.push(`CPF repetido em ${n} contas (final ${String(cpf).slice(-4)}) — possível abuso de trial.`));
  // 3) uso de imagens muito alto (possível abuso antes de cancelar)
  arr.forEach(c => {
    const img = c.uso && c.uso.imagens ? Number(c.uso.imagens) : 0;
    if (img > 80) alertas.push(`${c.email}: ${img} imagens este mês — uso muito acima do normal.`);
  });

  if (!alertas.length) return { avisos: 0 };
  // Evita duplicar: marca o dia
  const tag = `seg_${new Date().toISOString().slice(0,10)}`;
  let criados = 0;
  for (const adminId of adminIds) {
    // já avisou hoje?
    const existe = await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${adminId}&tipo=eq.seguranca&mensagem=like=*${tag}*&select=id&limit=1`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
    if (Array.isArray(existe) && existe.length) continue;
    await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({
        user_id: adminId, tipo: 'seguranca',
        titulo: `🛡 ${alertas.length} alerta(s) de segurança`,
        mensagem: alertas.join(' | ') + ` [${tag}]`,
        lido: false, resolvido: false,
      }),
    }).catch(()=>{});
    criados++;
  }
  return { avisos: criados, alertas: alertas.length };
}


// ═══ PUBLICAÇÃO AUTOMÁTICA NO INSTAGRAM (Plus/Pro pagantes; Básico = manual; trial = trava física) ═══
async function jobPublicar() {
  const agoraISO = new Date().toISOString();
  const posts = await fetch(
    `${SUPABASE_URL}/rest/v1/conteudos?status=eq.aprovado&midia_url=not.is.null&or=(data_agendada.lte.${agoraISO},and(data_agendada.is.null,data_sugerida.lte.${agoraISO}))&select=id,user_id,tema,formato,legenda,midia_url,erro_publicacao&order=data_agendada.asc&limit=25`,
    { headers: SBH() }
  ).then(r => r.json()).catch(() => []);
  if (!Array.isArray(posts) || !posts.length) return { publicados: 0, fila: 0 };
  let pub = 0; const porUser = {}; // anti-bloqueio: 1 publicação por conta por rodada (espaçamento natural)
  for (const p of posts) {
    if (porUser[p.user_id]) continue;
    const cli = (await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${p.user_id}&select=plano,tipo_cortesia,status,bloqueado`, { headers: SBH() }).then(r => r.json()).catch(() => []))[0];
    if (!cli || cli.bloqueado || cli.status !== 'ativo') continue;
    if (!['plus', 'pro'].includes(cli.plano)) continue;   // Básico posta manualmente
    if (cli.tipo_cortesia === 'trial') continue;          // trial: sem publicação automática
    const conta = (await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${p.user_id}&tipo=eq.instagram&select=token,meta`, { headers: SBH() }).then(r => r.json()).catch(() => []))[0];
    if (!conta || !conta.token || !(conta.meta && conta.meta.ig_id) || conta.meta.token_status === 'expirado') continue;
    porUser[p.user_id] = 1;
    try {
      const igId = conta.meta.ig_id, tk = conta.token;
      const ehVideo = /reel|v[ií]deo|video/i.test(p.formato || '') || /\.(mp4|mov)(\?|$)/i.test(p.midia_url || '');
      const caption = String(p.legenda || p.tema || '').slice(0, 2100);
      // 1) cria o container de mídia
      const body = ehVideo
        ? { media_type: 'REELS', video_url: p.midia_url, caption }
        : { image_url: p.midia_url, caption };
      const c1 = await fetch(`https://graph.instagram.com/v19.0/${igId}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, access_token: tk }),
      }).then(r => r.json());
      if (!c1.id) throw new Error((c1.error && c1.error.message) || 'container recusado');
      // 2) vídeo: aguarda o processamento da Meta (até ~50s)
      if (ehVideo) {
        let pronto = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const st = await fetch(`https://graph.instagram.com/v19.0/${c1.id}?fields=status_code&access_token=${tk}`).then(r => r.json());
          if (st.status_code === 'FINISHED') { pronto = true; break; }
          if (st.status_code === 'ERROR') throw new Error('a Meta recusou o vídeo (formato/duração)');
        }
        if (!pronto) throw new Error('vídeo ainda processando — nova tentativa na próxima rodada');
      }
      // 3) publica
      const c2 = await fetch(`https://graph.instagram.com/v19.0/${igId}/media_publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: c1.id, access_token: tk }),
      }).then(r => r.json());
      if (!c2.id) throw new Error((c2.error && c2.error.message) || 'publicação recusada');
      await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${p.id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ status: 'publicado', ig_post_id: c2.id, publicado_em: new Date().toISOString(), erro_publicacao: null }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
        method: 'POST', headers: SBH(),
        body: JSON.stringify({ user_id: p.user_id, tipo: 'publicacao', titulo: 'Post publicado no Instagram ✅', mensagem: `"${p.tema || 'Seu post'}" foi publicado automaticamente${conta.meta.ig_username ? ' em @' + conta.meta.ig_username : ''}.`, lido: false, resolvido: false }),
      });
      pub++;
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 180);
      await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${p.id}`, {
        method: 'PATCH', headers: SBH(), body: JSON.stringify({ erro_publicacao: msg }),
      }).catch(() => {});
      if (!p.erro_publicacao) { // notifica só na PRIMEIRA falha (sem spam a cada rodada)
        await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
          method: 'POST', headers: SBH(),
          body: JSON.stringify({ user_id: p.user_id, tipo: 'alerta', titulo: 'Falha ao publicar no Instagram', mensagem: `Não consegui publicar "${p.tema || 'seu post'}": ${msg.slice(0, 120)}. Vou tentar de novo automaticamente; se persistir, confira a conexão em "Conectar contas".`, lido: false, resolvido: false }),
        }).catch(() => {});
      }
    }
  }
  return { publicados: pub, fila: posts.length };
}


// ═══ COLETA DE MÉTRICAS DO INSTAGRAM (alimenta a dashboard e os agentes) ═══
async function jobMetricas() {
  const contas = await fetch(
    `${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&select=user_id,token,meta`,
    { headers: SBH() }
  ).then(r => r.json()).catch(() => []);
  if (!Array.isArray(contas) || !contas.length) return { coletadas: 0 };
  const hoje = new Date().toISOString().slice(0, 10);
  let ok = 0;
  for (const c of contas) {
    try {
      if (!c.token || (c.meta && c.meta.token_status === 'expirado')) continue;
      // 1 coleta por dia por usuário
      const ja = await fetch(`${SUPABASE_URL}/rest/v1/metricas?user_id=eq.${c.user_id}&data_coleta=eq.${hoje}&select=id&limit=1`, { headers: SBH() }).then(r => r.json()).catch(() => []);
      const idHoje = (Array.isArray(ja) && ja[0] && ja[0].id) || null; // já coletou hoje? então ATUALIZA (coleta intradia)
      const igId = (c.meta && c.meta.ig_id) || 'me';
      // perfil
      const prof = await fetch(`https://graph.instagram.com/v19.0/${igId}?fields=followers_count,media_count&access_token=${c.token}`).then(r => r.json());
      if (prof.error) throw new Error(prof.error.message);
      const seguidores = prof.followers_count || 0;
      // alcance 28 dias (se a conta permitir)
      let alcance = 0;
      try {
        const ins = await fetch(`https://graph.instagram.com/v19.0/${igId}/insights?metric=reach&period=days_28&access_token=${c.token}`).then(r => r.json());
        const v = ins.data && ins.data[0] && ins.data[0].values;
        alcance = (v && v[v.length - 1] && v[v.length - 1].value) || 0;
      } catch (e) {}
      // interações dos últimos 30 dias (likes + comentários das mídias recentes)
      let inter = 0, posts30 = 0;
      try {
        const md = await fetch(`https://graph.instagram.com/v19.0/${igId}/media?fields=like_count,comments_count,timestamp&limit=30&access_token=${c.token}`).then(r => r.json());
        const corte = Date.now() - 30 * 24 * 3600 * 1000;
        for (const m of (md.data || [])) {
          if (new Date(m.timestamp).getTime() < corte) continue;
          posts30++; inter += (m.like_count || 0) + (m.comments_count || 0);
        }
      } catch (e) {}
      // engajamento: interações ÷ alcance (padrão de mercado); fallback: ÷ seguidores
      const base = alcance || seguidores || 1;
      const engaj = Math.round((inter / base) * 1000) / 10; // 1 casa decimal
      const corpo = { user_id: c.user_id, data_coleta: hoje, seguidores, engajamento_30d: engaj, alcance, posts: posts30 };
      if (idHoje) {
        await fetch(`${SUPABASE_URL}/rest/v1/metricas?id=eq.${idHoje}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify(corpo) });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/metricas`, { method: 'POST', headers: { ...SBH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(corpo) });
      }
      // atualiza o snapshot da conexão (o fallback da dashboard)
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${c.user_id}&tipo=eq.instagram`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ meta: { ...(c.meta || {}), ig_followers: seguidores, ig_media: prof.media_count || 0 } }),
      }).catch(() => {});
      ok++;
    } catch (e) { console.error('metricas', c.user_id, e.message); }
  }
  return { coletadas: ok, contas: contas.length };
}

module.exports = async (req, res) => {
  // Segurança: só executa com o segredo certo
  const auth = req.headers['authorization'] || '';
  const qsec = (req.query && req.query.secret) || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}` && qsec !== process.env.CRON_SECRET) {
    const s = String(process.env.CRON_SECRET || '');
    return res.status(401).json({
      error: 'não autorizado',
      diagnostico: { secret_definida: !!s, tamanho: s.length, comeca_com: s.slice(0, 2), recebido_tamanho: String(qsec || '').length },
    });
  }
async function jobOrdens() {
  // Lembrete barato (sem IA): avisa usuários com ordens pendentes + ativa recorrentes do dia
  const hoje = new Date().toISOString().slice(0, 10);
  const diaDoMes = new Date().getDate();
  const diaSemana = new Date().getDay(); // 0=domingo
  let lembretes = 0, recCriadas = 0;

  // 1) Ordens recorrentes: gera a ordem do ciclo (1x por período) com anti-duplicata
  const recorrentes = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?recorrencia=not.is.null&select=*`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
  for (const o of (Array.isArray(recorrentes) ? recorrentes : [])) {
    // mensal: dispara no dia 1; semanal: dispara na segunda (diaSemana 1)
    const deveDisparar = (o.recorrencia === 'mensal' && diaDoMes === 1) || (o.recorrencia === 'semanal' && diaSemana === 1);
    if (!deveDisparar) continue;
    if (o.ultimo_lembrete === hoje) continue; // já disparou hoje
    // cria a ordem do ciclo (pendente, avulsa, derivada da recorrente)
    await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: o.user_id, de_agente: 'usuario', para_agente: o.para_agente, tarefa: 'tarefa_usuario', detalhe: o.detalhe, status: 'pendente' }),
    }).catch(()=>{});
    await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ ultimo_lembrete: hoje }) }).catch(()=>{});
    recCriadas++;
  }

  // 2) Lembrete: para cada usuário com ordens pendentes, cria 1 recado (anti-duplicata por dia)
  const pend = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?status=eq.pendente&select=user_id`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
  const porUser = {};
  for (const p of (Array.isArray(pend) ? pend : [])) { porUser[p.user_id] = (porUser[p.user_id] || 0) + 1; }
  const tag = 'ord-' + hoje;
  for (const uid of Object.keys(porUser)) {
    const existe = await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${uid}&tipo=eq.ordens&mensagem=like=*${tag}*&select=id&limit=1`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
    if (Array.isArray(existe) && existe.length) continue;
    await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: uid, tipo: 'ordens', titulo: 'Você tem ordens esperando', mensagem: `Você tem ${porUser[uid]} ordem(ns) pendente(s) na Central de Ordens. [${tag}]`, lido: false, resolvido: false }),
    }).catch(()=>{});
    lembretes++;
  }
  // 3) CONVERSÃO PÓS-TRIAL: quem tinha trial e o período já venceu → marca p/ completar estratégia
  //    (o agente Estratégia, no próximo acesso, gera o mês completo + tarefas). Anti-duplicata por flag.
  let convertidos = 0;
  const exTrial = await fetch(`${SUPABASE_URL}/rest/v1/clientes?tipo_cortesia=eq.trial&status=eq.ativo&select=id,onboarding,cortesia_ate`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
  const agora = Date.now();
  for (const c of (Array.isArray(exTrial) ? exTrial : [])) {
    if (!c.cortesia_ate || new Date(c.cortesia_ate).getTime() > agora) continue; // ainda no trial
    const onb = c.onboarding || {};
    if (onb.completar_estrategia || onb.estrategia_completada) continue; // já marcado/feito
    // marca a flag e encerra o trial (tipo_cortesia deixa de ser 'trial')
    await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${c.id}`, {
      method: 'PATCH', headers: SBH(),
      body: JSON.stringify({ tipo_cortesia: null, onboarding: { ...onb, completar_estrategia: true } }),
    }).catch(()=>{});
    // avisa o cliente que a conta foi ativada e o mês completo será gerado
    await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({ user_id: c.id, tipo: 'sistema', titulo: 'Seu plano está ativo! 🎉', mensagem: 'Seu período de teste terminou e sua assinatura está ativa. Fale com o agente de Estratégia para gerar seu calendário completo do mês.', lido: false, resolvido: false }),
    }).catch(()=>{});
    convertidos++;
  }

  return { recorrentes_criadas: recCriadas, lembretes, convertidos };
}

async function jobLimpeza() {
  // Remove arquivos com +60 dias (protege o Supabase grátis). Barato, sem IA.
  const LIMITE_DIAS = 60;
  const corte = new Date(Date.now() - LIMITE_DIAS * 24 * 60 * 60 * 1000).toISOString();
  let removidos = 0;

  // 1) Vídeos crus e imagens geradas antigas (tabela uploads)
  const antigos = await fetch(`${SUPABASE_URL}/rest/v1/uploads?created_at=lt.${corte}&categoria=in.(videos,gerados)&select=id,path,categoria`, { headers: SBH() }).then(r => r.json()).catch(() => []);
  for (const u of (Array.isArray(antigos) ? antigos : [])) {
    try {
      // remove do Storage (bucket conforme a categoria)
      const bucket = u.categoria === 'videos' ? 'videos-crus' : 'user-uploads';
      if (u.path) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${u.path}`, { method: 'DELETE', headers: SBH() }).catch(() => {});
      }
      // remove o registro
      await fetch(`${SUPABASE_URL}/rest/v1/uploads?id=eq.${u.id}`, { method: 'DELETE', headers: SBH() }).catch(() => {});
      removidos++;
    } catch (e) { /* ignora */ }
  }

  // 2) Jobs de vídeo antigos (libera a tabela; o vídeo no Shotstack já expirou)
  await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?created_at=lt.${corte}`, { method: 'DELETE', headers: SBH() }).catch(() => {});

  return { removidos };
}

  const job = (req.query && req.query.job) || '';
  try {
    if (job === 'estrategia') {
      const r = await jobEstrategia();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'tokens') {
      const r = await jobTokens();
      let m = {}; try { m = await jobMetricas(); } catch (e) {}
      return res.status(200).json({ ok: true, job, ...r, metricas: m });
    }
    if (job === 'metricas') {
      const r = await jobMetricas();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'seguranca') {
      const r = await jobSeguranca();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'ordens') {
      const r = await jobOrdens();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'publicar') {
      const r = await jobPublicar();
      return res.status(200).json({ ok: true, job, ...r });
    }
    if (job === 'limpeza') {
      const r = await jobLimpeza();
      return res.status(200).json({ ok: true, job, ...r });
    }
    return res.status(400).json({ error: 'job inválido (use ?job=estrategia, tokens, seguranca, ordens, publicar ou limpeza)' });
  } catch (e) {
    console.error('cron:', e.message);
    return res.status(500).json({ error: 'falha no cron', job });
  }
};
