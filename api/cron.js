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

module.exports = async (req, res) => {
  // Segurança: só executa com o segredo certo
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'não autorizado' });
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
  return { recorrentes_criadas: recCriadas, lembretes };
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
    if (job === 'limpeza') {
      const r = await jobLimpeza();
      return res.status(200).json({ ok: true, job, ...r });
    }
    return res.status(400).json({ error: 'job inválido (use ?job=estrategia, tokens, seguranca, ordens ou limpeza)' });
  } catch (e) {
    console.error('cron:', e.message);
    return res.status(500).json({ error: 'falha no cron', job });
  }
};
