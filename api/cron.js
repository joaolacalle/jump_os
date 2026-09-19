// api/cron.js — Crons consolidados (estratégia + renovação de tokens em 1 função)
// Resolve o limite de funções da Vercel. Decide o job por ?job=
//   ?job=estrategia → avisa 5 dias antes de fechar o ciclo de 30d de CADA cliente (preferencias.estrategia_em)
//   ?job=tokens     → renova tokens da Meta que expiram em < 10 dias (diário)
// Protegido por CRON_SECRET.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
// HANDOFF — CADEIA (11/set/2026): avanço/timeout genéricos, ver api/_cadeia-lib.js.
const { avancarCadeia, verificarTimeoutCadeia } = require('./_cadeia-lib');
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});
// FONTE ÚNICA de classificação de conteúdo (produzível em imagem × depende de material do
// usuário) — ver assets/classificacao.js. Este é o gate que de fato barra produção (jobProduzir);
// nenhum ponto deste arquivo testa formato por conta própria a partir de agora (Fase 1 do plano
// "Trilha de material do usuário", 25/ago/2026).
const JC = require('../assets/classificacao.js');
// REPARO AVULSO — SEXTA PORTA (05/set/2026): a criação do card 'aprovar_semana' (mais abaixo,
// job de drip semanal) agora vem de um módulo único, também consultado por api/agente-chat.js —
// ver api/_semana-lib.js para o porquê (Família 2 do Contrato: mesma decisão em N lugares).
const { garantirCardAprovarSemana, clientesElegiveisSemana } = require('./_semana-lib.js');
// FILA TÉCNICA — item 3 (09/set/2026, ver APRENDIZADOS.md "FILA TÉCNICA — CINCO CORREÇÕES"):
// `jobMetricas`, `jobSeguranca` e `jobOrdens` calculavam "hoje" com `new Date()` cru (UTC, o
// fuso do processo na Vercel) em vez de `JC.hojeISOBrasil()` (fonte única de "hoje" já usada no
// resto do sistema) — mesma pergunta ("que dia é hoje?") respondida de duas formas, Família 2.
// Não erra hoje porque os horários dos crons (vercel.json) caem longe da meia-noite de SP —
// risco latente registrado desde a investigação de 08/09/2026 ("DATA DO SERVIDOR ATRASADA"),
// verificado numericamente (730 dias, nos horários reais de disparo, ver
// /tmp/test_frente_datas_cron.js) antes de aplicar: nenhuma divergência.
// `_hojeSPComoData(iso)` parseia o resultado de `hojeISOBrasil()` (já resolvido pro calendário de
// SP) como UTC PURO — nunca reinterpretar por um terceiro fuso ao extrair dia-do-mês/dia-da-semana
// (mesma técnica que `_toDataUTC` já usa em assets/classificacao.js).
function _hojeSPComoData(iso) { return new Date(iso + 'T00:00:00Z'); }

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// ── JOB 1: aviso da PRÓXIMA estratégia — 5 dias antes de fechar o ciclo do usuário ──
//    O ciclo conta a partir da DATA DA ESTRATÉGIA de cada cliente (preferencias.estrategia_em),
//    não do dia 25 do mês. Roda diário; avisa uma única vez por ciclo.
async function jobEstrategia() {
  const CICLO = 30, AVISO_ANTES = 5;
  const clientes = await fetch(
    `${SUPABASE_URL}/rest/v1/clientes?status=eq.ativo&select=id,nome,plano,tipo_cortesia,cortesia_ate,preferencias`, { headers: SBH() }
  ).then(r => r.json());
  if (!Array.isArray(clientes)) return { avisos: 0 };
  let criados = 0, semCiclo = 0;
  for (const c of clientes) {
    // pula quem está no período de teste (a estratégia do trial é de 7 dias, não mensal)
    if (c.tipo_cortesia === 'trial' && c.cortesia_ate && new Date(c.cortesia_ate).getTime() > Date.now()) continue;
    const pref = (c.preferencias && typeof c.preferencias === 'object') ? c.preferencias : {};
    if (!pref.estrategia_em) { semCiclo++; continue; } // ainda não gerou a 1ª estratégia
    const inicio = new Date(pref.estrategia_em).getTime();
    const fimCiclo = inicio + CICLO * 864e5;
    const faltam = Math.ceil((fimCiclo - Date.now()) / 864e5);
    if (faltam > AVISO_ANTES || faltam < 0) continue; // só na janela dos 5 dias finais
    const tag = `estrategia_ciclo_${new Date(inicio).toISOString().slice(0, 10)}`;
    const existe = await fetch(
      `${SUPABASE_URL}/rest/v1/recados?user_id=eq.${c.id}&mensagem=like.*${tag}*&select=id&limit=1`, { headers: SBH() }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existe) && existe.length) continue; // já avisado neste ciclo
    const quando = faltam <= 0 ? 'hoje' : (faltam === 1 ? 'amanhã' : `em ${faltam} dias`);
    await fetch(`${SUPABASE_URL}/rest/v1/recados`, {
      method: 'POST', headers: SBH(),
      body: JSON.stringify({
        user_id: c.id, tipo: 'info',
        titulo: 'Hora de planejar o próximo mês',
        mensagem: `Sua estratégia atual fecha o ciclo ${quando}. Abra o Agente de Estratégia e peça o plano do próximo mês — eu já disparo as ordens para o Designer e a Publicação. [${tag}]`,
        lido: false, resolvido: false,
      }),
    }).catch(() => {});
    criados++;
  }
  return { avisos: criados, sem_ciclo: semCiclo };
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
  // Evita duplicar: marca o dia. FILA TÉCNICA — item 3 (09/set/2026): era `new Date()` cru (UTC),
  // trocado por `JC.hojeISOBrasil()` — fonte única, ver nota no topo do arquivo.
  const tag = `seg_${JC.hojeISOBrasil()}`;
  let criados = 0;
  for (const adminId of adminIds) {
    // já avisou hoje?
    const existe = await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${adminId}&tipo=eq.seguranca&mensagem=like.*${tag}*&select=id&limit=1`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
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
async function jobPublicar(soUserId) {
  const agoraISO = new Date().toISOString();
  const filtroUser = soUserId ? `&user_id=eq.${soUserId}` : '';
  const posts = await fetch(
    `${SUPABASE_URL}/rest/v1/conteudos?status=eq.aprovado&midia_url=not.is.null&or=(data_agendada.lte.${agoraISO},and(data_agendada.is.null,data_sugerida.lte.${agoraISO}))${filtroUser}&select=id,user_id,tema,formato,copy,midia_url,erro_publicacao,meta&order=data_agendada.asc&limit=25`,
    { headers: SBH() }
  ).then(r => r.json()).catch(() => []);
  // ELO DO ADS: arte com finalidade 'anuncio' NUNCA é publicada organicamente — o cliente a
  // baixa e sobe no Gerenciador dele. Filtro no código (finalidade vive em meta jsonb).
  const posts0 = Array.isArray(posts) ? posts.filter(p => !(p.meta && p.meta.finalidade === 'anuncio')) : [];
  if (!posts0.length) return { publicados: 0, fila: 0 };
  let pub = 0; const porUser = {}; // anti-bloqueio: 1 publicação por conta por rodada (espaçamento natural)
  for (const p of posts0) {
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
      // STORY: media_type ausente (15/set/2026, "Publicação de Stories — tipo de mídia ausente"),
      // achado reportado na rodada anterior (caption) e corrigido agora. `formato` já vem no
      // SELECT que buscou `posts`, não precisa de consulta nova — e a detecção usa a FONTE ÚNICA
      // (assets/classificacao.js, `JC.ehStory`), não um regex local: o projeto já teve dez pontos
      // divergindo sobre formato (ver cabeçalho de classificacao.js) e este é mais um ponto que
      // precisa saber "isto é story" — passou a perguntar à fonte única em vez de testar sozinho.
      // `JC.ehStory` foi adicionado nesta rodada (não existia antes) — `JC.emValidacao` também
      // bate só com 'story' hoje, mas significa outra coisa (quarentena de PRODUÇÃO AUTOMÁTICA,
      // ver nota em classificacao.js) e não deve ser reaproveitada pra este fim; os dois valores
      // coincidem por acaso hoje, não por definição.
      //
      // Documentação da Meta (Content Publishing API / referência do endpoint IG User /media),
      // verificada antes de implementar — não presumida por analogia com reels:
      //   - media_type:'STORIES' aceita tanto image_url (Story de imagem) quanto video_url (Story
      //     de vídeo) — é o MESMO container de mídia dos outros formatos, só com o tipo declarado.
      //   - O fluxo é o mesmo dos demais: cria o container → (vídeo) aguarda processamento → publica
      //     via media_publish com o creation_id. Nenhuma rota nova precisa existir só pra Stories.
      //   - `caption` NÃO é um parâmetro suportado por media_type:'STORIES' — a documentação lista
      //     explicitamente como não suportado. Reforça (não só "não é usado pela interface", como
      //     a correção anterior já tratava) que o valor correto é omitir a chave, não mandar vazio.
      //   - Vídeo: MOV/MP4, até 100MB, 3 a 60 segundos. Imagem: JPEG, até 8MB. Nenhuma validação
      //     nova adicionada aqui pra esses limites — se a Meta recusar (vídeo fora da janela, por
      //     exemplo), o `catch` já existente grava `erro_publicacao` e avisa o cliente (nunca
      //     falha silenciosa), o mesmo tratamento que já cobre qualquer recusa de container hoje.
      //   - `is_carousel_item` não é suportado por Stories — não é uma restrição nova pra este
      //     código: a produção automática de story está em quarentena (`FORMATOS_EM_VALIDACAO`) e
      //     a criação manual (calendario.html) nunca grava `meta.slides`, então `ehCarrossel`
      //     (abaixo) já não alcança story na prática; não adicionei uma trava redundante.
      const ehStory = JC.ehStory(p);
      const caption = ehStory ? '' : String(p.copy || p.tema || '').slice(0, 2100);
      // CARROSSEL: os slides ficam em meta.slides (gravados pelo Designer); a capa é o midia_url.
      const slidesArr = (p.meta && Array.isArray(p.meta.slides)) ? p.meta.slides.filter(s => s && s.url).slice().sort((a, b) => Number(a.n) - Number(b.n)) : [];
      const ehCarrossel = !ehVideo && slidesArr.length > 1;
      const criarContainer = (payload) => fetch(`https://graph.instagram.com/v19.0/me/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, access_token: tk }),
      }).then(r => r.json());
      // 1) cria o container de mídia (carrossel: filhos em ordem → pai CAROUSEL)
      let c1;
      if (ehCarrossel) {
        const filhos = [];
        for (const s of slidesArr.slice(0, 10)) { // Instagram: máx 10 itens por carrossel
          const ch = await criarContainer({ image_url: s.url, is_carousel_item: true });
          if (!ch.id) throw new Error((ch.error && ch.error.message) || 'slide do carrossel recusado');
          filhos.push(ch.id);
        }
        c1 = await criarContainer({ media_type: 'CAROUSEL', children: filhos, caption });
      } else {
        const body = ehStory
          ? (ehVideo ? { media_type: 'STORIES', video_url: p.midia_url } : { media_type: 'STORIES', image_url: p.midia_url })
          : (ehVideo ? { media_type: 'REELS', video_url: p.midia_url, caption } : { image_url: p.midia_url, caption });
        c1 = await criarContainer(body);
      }
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
      const c2 = await fetch(`https://graph.instagram.com/v19.0/me/media_publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: c1.id, access_token: tk }),
      }).then(r => r.json());
      if (!c2.id) throw new Error((c2.error && c2.error.message) || 'publicação recusada');
      await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${p.id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ status: 'publicado', ig_post_id: c2.id, publicado_em: new Date().toISOString(), erro_publicacao: null }),
      });
      // progresso da ordem "publicar_calendario" (ex: 3/12) — visível em Tarefas, em tempo real
      try {
        const od = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?user_id=eq.${p.user_id}&para_agente=eq.publicacao&tarefa=eq.publicar_calendario&status=in.(pendente,processando)&select=id,total,progresso&limit=1`, { headers: SBH() }).then(r => r.json()).catch(() => []);
        if (Array.isArray(od) && od[0]) {
          const pg = (od[0].progresso || 0) + 1;
          const fim = od[0].total && pg >= od[0].total;
          await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${od[0].id}`, {
            method: 'PATCH', headers: SBH(),
            body: JSON.stringify(fim ? { progresso: pg, status: 'concluida', concluida_em: new Date().toISOString() } : { progresso: pg, status: 'processando' }),
          }).catch(() => {});
        }
      } catch (e) {}
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
  return { publicados: pub, fila: posts0.length };
}


// ═══ COLETA DE MÉTRICAS DO INSTAGRAM (alimenta a dashboard e os agentes) ═══
async function jobMetricas() {
  const contas = await fetch(
    `${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&select=user_id,token,meta`,
    { headers: SBH() }
  ).then(r => r.json()).catch(() => []);
  if (!Array.isArray(contas) || !contas.length) return { coletadas: 0 };
  // FILA TÉCNICA — item 3 (09/set/2026): era `new Date()` cru (UTC), trocado por
  // `JC.hojeISOBrasil()` — fonte única, ver nota no topo do arquivo.
  const hoje = JC.hojeISOBrasil();
  let ok = 0; const erros = [];
  for (const c of contas) {
    try {
      if (!c.token || (c.meta && c.meta.token_status === 'expirado')) continue;
      // 1 coleta por dia por usuário
      const ja = await fetch(`${SUPABASE_URL}/rest/v1/metricas?user_id=eq.${c.user_id}&data_coleta=eq.${hoje}&select=id&limit=1`, { headers: SBH() }).then(r => r.json()).catch(() => []);
      const idHoje = (Array.isArray(ja) && ja[0] && ja[0].id) || null; // já coletou hoje? então ATUALIZA (coleta intradia)
      const igId = 'me'; // Instagram Business Login: o token identifica a conta (IDs numéricos falham na leitura)
      // perfil
      const prof = await fetch(`https://graph.instagram.com/v19.0/me?fields=username,followers_count,media_count&access_token=${c.token}`).then(r => r.json());
      if (prof.error) throw new Error(prof.error.message);
      const seguidores = prof.followers_count || 0;
      // alcance 28 dias — Instagram Login exige metric_type=total_value
      let alcance = 0;
      try {
        const ins = await fetch(`https://graph.instagram.com/v19.0/me/insights?metric=reach&period=days_28&metric_type=total_value&access_token=${c.token}`).then(r => r.json());
        if (ins.error) { erros.push('insights: ' + ins.error.message.slice(0, 120)); }
        const d0 = ins.data && ins.data[0];
        alcance = (d0 && d0.total_value && d0.total_value.value)
          || (d0 && d0.values && d0.values.length && d0.values[d0.values.length - 1].value) || 0;
      } catch (e) { erros.push('insights: ' + String(e.message).slice(0, 100)); }
      // interações + saves + shares dos últimos 30 dias, e ranking por post.
      // saved/shares vêm de insights por mídia (Instagram Login entrega; impressions não-Reels NÃO).
      let inter = 0, posts30 = 0, saves = 0, shares = 0, reachPosts = 0;
      const porPost = [];
      let porFormato = { IMAGE: { n:0, eng:0 }, CAROUSEL_ALBUM: { n:0, eng:0 }, VIDEO: { n:0, eng:0 }, REELS: { n:0, eng:0 } };
      const porDiaHora = {}; // 'dow-hh' -> soma de engajamento (melhor horário)
      try {
        const md = await fetch(`https://graph.instagram.com/v19.0/me/media?fields=id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url&limit=30&access_token=${c.token}`).then(r => r.json());
        if (md.error) { erros.push('media: ' + md.error.message.slice(0, 120)); }
        const corte = Date.now() - 30 * 24 * 3600 * 1000;
        for (const m of (md.data || [])) {
          if (new Date(m.timestamp).getTime() < corte) continue;
          posts30++;
          const eng = (m.like_count || 0) + (m.comments_count || 0);
          inter += eng;
          // insights por post (saved, shares, reach) — falha silenciosa por post não derruba a coleta
          let sv = 0, sh = 0, rc = 0;
          try {
            const pi = await fetch(`https://graph.instagram.com/v19.0/${m.id}/insights?metric=saved,shares,reach&access_token=${c.token}`).then(r => r.json());
            for (const d of (pi.data || [])) {
              const v = (d.values && d.values[0] && d.values[0].value) || 0;
              if (d.name === 'saved') sv = v; else if (d.name === 'shares') sh = v; else if (d.name === 'reach') rc = v;
            }
          } catch (_) {}
          saves += sv; shares += sh; reachPosts += rc;
          // formato (REELS quando media_product_type=REELS)
          const fmt = (m.media_product_type === 'REELS') ? 'REELS' : (m.media_type || 'IMAGE');
          if (porFormato[fmt]) { porFormato[fmt].n++; porFormato[fmt].eng += eng + sv + sh; }
          // melhor horário (dia da semana + hora do post, ponderado por engajamento)
          const dt = new Date(m.timestamp);
          const chave = dt.getDay() + '-' + String(dt.getHours()).padStart(2, '0');
          porDiaHora[chave] = (porDiaHora[chave] || 0) + eng + sv + sh;
          porPost.push({ id: m.id, cap: (m.caption || '').slice(0, 80), tipo: fmt, likes: m.like_count || 0, coments: m.comments_count || 0, saves: sv, shares: sh, reach: rc, eng: eng + sv + sh, link: m.permalink || '', thumb: m.thumbnail_url || m.media_url || '', quando: m.timestamp });
        }
      } catch (e) { erros.push('media: ' + String(e.message).slice(0, 100)); }
      // share rate = shares ÷ alcance dos posts (o sinal nº1 de 2026 segundo Mosseri)
      const shareRate = reachPosts ? Math.round((shares / reachPosts) * 1000) / 10 : 0;
      // melhor horário: a chave com maior engajamento acumulado
      const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      let melhorHorario = null;
      { const top = Object.entries(porDiaHora).sort((a,b)=>b[1]-a[1])[0];
        if (top) { const [d,h] = top[0].split('-'); melhorHorario = DOW[Number(d)] + ' ' + h + 'h'; } }
      // melhor formato: o de maior engajamento médio
      let melhorFormato = null;
      { const cand = Object.entries(porFormato).filter(([,x])=>x.n>0).map(([k,x])=>[k, x.eng/x.n]).sort((a,b)=>b[1]-a[1])[0];
        const NOMES = { IMAGE:'Feed', CAROUSEL_ALBUM:'Carrossel', VIDEO:'Vídeo', REELS:'Reels' };
        if (cand) melhorFormato = NOMES[cand[0]] || cand[0]; }
      // crescimento de seguidores (série dos últimos 28 dias) — para o gráfico de linha
      let novos28 = 0, serieSeguidores = [];
      try {
        const fc = await fetch(`https://graph.instagram.com/v19.0/me/insights?metric=follower_count&period=day&access_token=${c.token}`).then(r => r.json());
        const vals = (fc.data && fc.data[0] && fc.data[0].values) || [];
        serieSeguidores = vals.map(v => ({ d: (v.end_time || '').slice(0,10), n: v.value || 0 }));
        novos28 = vals.reduce((a,v)=>a+(v.value||0), 0);
      } catch (_) {}
      // demografia (idade/gênero/cidade) — exige 100+ seguidores; falha silenciosa se não houver
      let demografia = null;
      if ((prof.followers_count || 0) >= 100) {
        try {
          const dem = await fetch(`https://graph.instagram.com/v19.0/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age,gender&access_token=${c.token}`).then(r => r.json());
          const tv = dem.data && dem.data[0] && dem.data[0].total_value && dem.data[0].total_value.breakdowns;
          if (tv && tv[0] && tv[0].results) demografia = tv[0].results.map(x => ({ k: (x.dimension_values||[]).join(' · '), v: x.value }));
        } catch (_) {}
      }
      // engajamento: interações ÷ alcance (padrão de mercado); fallback: ÷ seguidores
      const base = alcance || seguidores || 1;
      const engaj = Math.round((inter / base) * 1000) / 10; // 1 casa decimal
      const topPosts = porPost.slice().sort((a,b)=>b.eng-a.eng);
      const corpo = {
        user_id: c.user_id, data_coleta: hoje,
        seguidores, engajamento_30d: engaj, alcance, posts: posts30,
        alcance_30d: alcance, novos_seguidores_30d: novos28,
        melhor_horario: melhorHorario, melhor_formato: melhorFormato,
        taxa_alcance: seguidores ? Math.round((alcance / seguidores) * 1000) / 10 : null,
        dados_raw: {
          saves, shares, share_rate: shareRate,
          serie_seguidores: serieSeguidores,
          demografia,
          top_posts: topPosts.slice(0, 6),
          pior_post: topPosts.length > 2 ? topPosts[topPosts.length - 1] : null,
          por_formato: porFormato,
          coletado_em: new Date().toISOString(),
        },
      };
      const rIns = idHoje
        ? await fetch(`${SUPABASE_URL}/rest/v1/metricas?id=eq.${idHoje}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify(corpo) })
        : await fetch(`${SUPABASE_URL}/rest/v1/metricas`, { method: 'POST', headers: { ...SBH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(corpo) });
      if (!rIns.ok) throw new Error('gravar metricas (' + rIns.status + '): ' + (await rIns.text().catch(() => '')).slice(0, 120));
      // atualiza o snapshot da conexão (o fallback da dashboard)
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${c.user_id}&tipo=eq.instagram`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ meta: { ...(c.meta || {}), ig_followers: seguidores, ig_media: prof.media_count || 0, ig_username: prof.username || (c.meta && c.meta.ig_username) || '' } }),
      }).catch(() => {});
      ok++;
    } catch (e) { console.error('metricas', c.user_id, e.message); erros.push(String(e.message || e).slice(0, 160)); }
  }
  return { coletadas: ok, contas: contas.length, erros };
}

// ═══ WEBHOOK DO INSTAGRAM (comentários + DMs) → automação de DM por palavra-chave ═══
// Fica DENTRO do cron (chamado como /api/cron?job=webhook) para não estourar o teto de 12
// funções do Hobby. Contador de envios em clientes.uso.dm_envios (jsonb; reseta por mês).
const LIMS_DM = { basico: 0, plus: 100, pro: 300 };
const IG_MSG_V = 'v19.0';
function wNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
async function wContaPorIg(igId) {
  const arr = await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?tipo=eq.instagram&meta->>ig_id=eq.${encodeURIComponent(igId)}&select=user_id,token,meta`, { headers: SBH() }).then(r => r.json()).catch(() => []);
  return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
}
async function wRegras(uid) {
  const arr = await fetch(`${SUPABASE_URL}/rest/v1/automacoes_dm?user_id=eq.${uid}&ativo=eq.true&select=palavra_chave,mensagem,gatilho,origem`, { headers: SBH() }).then(r => r.json()).catch(() => []);
  return Array.isArray(arr) ? arr : [];
}
function wCasar(texto, regras, gatilho) {
  const t = wNorm(texto);
  return regras.find(r => {
    const g = String(r.gatilho || 'ambos');
    if (g !== 'ambos' && g !== gatilho) return false;
    if (r.origem === 'anuncio') return false; // v1: atende organico|ambos
    const kw = wNorm(r.palavra_chave);
    return kw && t.includes(kw);
  });
}
async function wCota(uid) {
  const cli = (await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${uid}&select=id,plano,limites,uso`, { headers: SBH() }).then(r => r.json()).catch(() => []))[0];
  if (!cli) return { ok: false };
  const lim = Number((cli.limites && cli.limites.dm_envios) != null ? cli.limites.dm_envios : (LIMS_DM[cli.plano] || 0));
  const usados = Number((cli.uso && cli.uso.dm_envios) || 0);
  return { ok: usados < lim, cli };
}
async function wDebitar(cli) {
  const uso = Object.assign({}, cli.uso || {}, { dm_envios: Number((cli.uso && cli.uso.dm_envios) || 0) + 1 });
  await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${cli.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ uso }) }).catch(() => {});
}
async function wEnviar(igId, token, recipient, texto) {
  const r = await fetch(`https://graph.instagram.com/${IG_MSG_V}/${igId}/messages`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, message: { text: String(texto || '').slice(0, 900) } }),
  });
  return r.ok;
}
async function processarWebhook(body) {
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const ent of entries) {
    const igId = String(ent.id || '');
    if (!igId) continue;
    const conta = await wContaPorIg(igId);
    if (!conta || !conta.token) continue;
    const regras = await wRegras(conta.user_id);
    if (!regras.length) continue;
    // comentários → private reply (uma por comentário)
    for (const ch of (Array.isArray(ent.changes) ? ent.changes : [])) {
      if (ch.field !== 'comments') continue;
      const v = ch.value || {}, texto = v.text || '', commentId = v.id;
      if (v.from && String(v.from.id) === igId) continue;
      const regra = wCasar(texto, regras, 'comentario');
      if (!regra || !commentId) continue;
      const cota = await wCota(conta.user_id);
      if (!cota.ok) continue;
      if (await wEnviar(igId, conta.token, { comment_id: commentId }, regra.mensagem)) await wDebitar(cota.cli);
    }
    // mensagens diretas → resposta na conversa (janela de 24h aberta pela msg do usuário)
    for (const mg of (Array.isArray(ent.messaging) ? ent.messaging : [])) {
      if (mg.message && mg.message.is_echo) continue;
      const senderId = mg.sender && mg.sender.id, texto = (mg.message && mg.message.text) || '';
      if (!senderId || !texto || String(senderId) === igId) continue;
      const regra = wCasar(texto, regras, 'dm');
      if (!regra) continue;
      const cota = await wCota(conta.user_id);
      if (!cota.ok) continue;
      if (await wEnviar(igId, conta.token, { id: senderId }, regra.mensagem)) await wDebitar(cota.cli);
    }
  }
}

module.exports = async (req, res) => {
  const job0 = (req.query && req.query.job) || '';
  // WEBHOOK do Instagram — a Meta chama /api/cron?job=webhook (sem CRON_SECRET).
  if (job0 === 'webhook') {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && q['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(String(q['hub.challenge'] == null ? '' : q['hub.challenge']));
      }
      return res.status(403).json({ error: 'verify_token inválido', env_definida: !!process.env.META_WEBHOOK_VERIFY_TOKEN });
    }
    if (req.method === 'POST') {
      try {
        let raw = '';
        await new Promise((ok) => { req.on('data', d => raw += d); req.on('end', ok); });
        try {
          const sig = String(req.headers['x-hub-signature-256'] || '');
          if (sig && process.env.META_APP_SECRET) {
            const crypto = require('crypto');
            const esp = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
            if (sig !== esp) return res.status(401).json({ error: 'assinatura inválida' });
          }
        } catch (e) {}
        const body = raw ? JSON.parse(raw) : (req.body || {});
        await processarWebhook(body);
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('webhook:', e.message);
        return res.status(200).json({ ok: true }); // nunca falhar o handshake da Meta
      }
    }
    return res.status(405).json({ error: 'método não suportado' });
  }
  // DISPARO PELO PRÓPRIO USUÁRIO (o navegador não tem o CRON_SECRET): publica SÓ os posts do
  // cliente autenticado. Usado quando sai criativo novo — não espera o cron da rodada.
  if (job0 === 'publicar_meu') {
    try {
      const tkUser = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (!tkUser) return res.status(401).json({ error: 'sem token' });
      const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${tkUser}` } }).then(r => r.json()).catch(() => null);
      const uid = u && u.id;
      if (!uid) return res.status(401).json({ error: 'token inválido' });
      const r = await jobPublicar(uid);
      return res.status(200).json({ ok: true, job: 'publicar_meu', ...r });
    } catch (e) {
      return res.status(200).json({ ok: false, erro: String(e.message || e).slice(0, 160) });
    }
  }
  // DISPARO PELO PRÓPRIO USUÁRIO: produz as ordens DELE agora, sem esperar a rodada do cron.
  // Reusa o mesmo padrão do 'publicar_meu' (autenticado por JWT) — é o AUTO-DISPATCH da fila.
  if (job0 === 'produzir_meu') {
    try {
      const tkUser = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (!tkUser) return res.status(401).json({ error: 'sem token' });
      const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${tkUser}` } }).then(r => r.json()).catch(() => null);
      const uid = u && u.id;
      if (!uid) return res.status(401).json({ error: 'token inválido' });
      const r = await jobProduzir(uid);
      return res.status(200).json({ ok: true, job: 'produzir_meu', ...r });
    } catch (e) {
      return res.status(200).json({ ok: false, erro: String(e.message || e).slice(0, 160) });
    }
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER DE PRODUÇÃO (server-side): gera as artes SEM depender do navegador.
// O usuário aprova e pode fechar tudo — os agentes seguem trabalhando aqui.
// Trava de concorrência: a ordem só é pega se ainda estiver 'pendente' (PATCH
// condicional), então duas execuções nunca produzem a mesma arte duas vezes.
// ═══════════════════════════════════════════════════════════════════════════════
async function jobProduzir(soUid) {
  // URL PÚBLICA E ESTÁVEL primeiro. VERCEL_URL aponta para o deployment específico, que fica sob
  // Deployment Protection → a chamada server-to-server voltava 401 "Protected deployment" e a
  // ordem morria em retry. SITE_URL já é a variável padrão do projeto (_email-lib, _video-lib).
  const base = String(process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/+$/, '');
  if (!base || !process.env.CRON_SECRET) return { erro: 'sem SITE_URL/CRON_SECRET' };
  const LOG = (o) => { try { console.log('[worker]', JSON.stringify(o)); } catch (e) {} }; // sem secrets
  // ESTADO ATIVO ≠ HISTÓRICO. 'erros' é o erro ATIVO da ordem; ao iniciar uma nova tentativa ou
  // ao concluir com sucesso, o erro da tentativa anterior sai do estado ativo e é ARQUIVADO em
  // 'historico' (auditoria preservada). Sem isso, uma ordem concluída exibia erro fóssil.
  // SLIDES PENDENTES (retomada): um carrossel é 1 conteúdo com N slides em meta.slides[].
  // Retorna só os que ainda NÃO foram persistidos — assim o retry nunca regera o que já existe.
  const slidesFaltantes = (c, slidePedido) => {
    const meta = c.meta || {};
    const tot = Math.max(1, Number(meta.total_slides || 1));
    if (slidePedido) return { tot, faltam: [Number(slidePedido)] };      // AJUSTE: só aquele slide
    if (tot <= 1) return { tot: 1, faltam: c.midia_url ? [] : [1] };     // imagem única: como hoje
    const feitosN = new Set((Array.isArray(meta.slides) ? meta.slides : []).map(x => Number(x && x.n)));
    if (c.midia_url) feitosN.add(1);                                      // capa vive em midia_url
    const faltam = [];
    for (let n = 1; n <= tot; n++) if (!feitosN.has(n)) faltam.push(n);
    return { tot, faltam };
  };
  const limparErroAtivo = (pl0) => {
    const pl = { ...(pl0 || {}) };
    if (Array.isArray(pl.erros) && pl.erros.length) {
      const hist = Array.isArray(pl.historico) ? pl.historico.slice(-9) : [];
      hist.push({ em: new Date().toISOString(), tentativa: Number(pl.tentativas || 0), erros: pl.erros });
      pl.historico = hist;
    }
    delete pl.erros;
    return pl;
  };
  let ordensFeitas = 0, artes = 0, direcoesAvulsas = 0, copiasCriativo = 0;

  // ═══════════════════════════════════════════════════════════════════════════════
  // DIREÇÃO AVULSA — elo 0 da cadeia Designer→Estratégia→Criativo (15/set/2026, "Worker executa
  // ordem pendente + correção do botão", autorizado pelo João, Opção A). Bloco PRÓPRIO, separado
  // do loop de imagem abaixo: a forma da tarefa é outra (aciona a Estratégia via chat, não gera
  // imagem, não tem posts/slides) — misturar as duas no mesmo loop obrigaria a espalhar ifs pela
  // lógica de imagem só pra pular esta tarefa. Fica DENTRO de jobProduzir (mesmo "processamento
  // de ordens pendentes" pedido), com seu próprio pequeno ciclo.
  //
  // SEM LOCK pendente→processando (diferente do loop de imagem, logo abaixo). Decisão de
  // idempotência (pedida explicitamente: "decidir e reportar"): o bloco que fecha esta ordem
  // continua em api/agente-chat.js (~linha 1907, "HANDOFF — CRIATIVO→ESTRATÉGIA") — não sai, e
  // roda EXATAMENTE igual pro chamador interno (agente==='estrategia' vale pros dois). A proteção
  // contra dupla execução concorrente já existe e é MAIS RÁPIDA que travar aqui: os três relógios
  // de _cadeia-lib.js (verificarTimeoutCadeia, a cada 5min — watchdog de passagem 2min + prazo
  // total) só enxergam ordem 'pendente' (nunca 'processando' — protegido, não alterado aqui). Se
  // travássemos pra 'processando' como o loop de imagem faz, a ordem sumiria desse radar rápido e
  // cairia só no watchdog genérico de jobOrdens (status=processando, 8min de heartbeat) — que
  // RODA 1x por dia (vercel.json, job=ordens às 8h): uma chamada travada ficaria até ~24h sem
  // erro visível, contra o combinado com o João ("os dois estouros de passagem já são a
  // retentativa embutida"). Risco aceito do lado oposto, sem lock: duas execuções raramente
  // concorrentes (só se a chamada anterior ainda não tiver fechado 'concluida' quando o próximo
  // cron de 5min bater — janela estreita, response normal leva segundos) podem, em tese, chamar a
  // Estratégia 2x pra mesma ordem. Já existe defesa contra o efeito colateral que importa:
  // avancarCadeia (_cadeia-lib.js, protegido) só cria UM elo 1 por ordem_pai — idempotência por
  // chave, não por ordem de execução. Na pior hipótese sobra um <conteudo> rascunho órfão
  // (avulso:true, nunca produzido) — custo de cota de TEXTO, não de imagem; não duplica arte nem
  // cobra o cliente 2x. Risco residual aceito e registrado, mesmo padrão já usado neste projeto
  // pro reparo de segunda chamada (ver api/agente-chat.js, comentário "histórico de duplicação").
  if (process.env.CRON_SECRET) {
    const pendDirecao = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?tarefa=eq.direcao_avulso_criativo&status=eq.pendente${soUid ? `&user_id=eq.${soUid}` : ''}&select=id,user_id,payload,detalhe&order=created_at.asc&limit=3`, { headers: SBH() }).then(r => r.json()).catch(() => []);
    for (const o of (Array.isArray(pendDirecao) ? pendDirecao : [])) {
      try {
        const pl = o.payload || {};
        // MENSAGEM SINTÉTICA — montada do payload (tema quando houver, formato, slides), pedido
        // explícito do João. Também deixa EXPLÍCITO que a confirmação já aconteceu (com o
        // Designer, fora deste chat): a Estratégia tem uma regra própria e válida de "apresente,
        // depois confirme, depois emita" (REGRAS_PEDIDO_AVULSO_ESTRATEGIA, protegida — não
        // alterada aqui) pensada pra conversa ao vivo com o cliente; sem este sinal explícito,
        // ela poderia tratar esta chamada como um pedido NOVO e ficar esperando uma confirmação
        // que, vindo do worker, nunca chega. Não foi possível testar isto ao vivo contra o modelo
        // real (sem ANTHROPIC_API_KEY neste ambiente, e nenhuma ordem deste tipo em produção
        // chegou a fechar por este caminho até hoje — ver relato completo). Rede de segurança se
        // a frase não bastar: a ordem continua 'pendente' (nada aqui trava pra 'processando'),
        // então os dois estouros de passagem de _cadeia-lib.js seguem cobrindo — erro visível em
        // poucos minutos, nunca preso em silêncio.
        const temaTxt = pl.tema ? `tema "${String(pl.tema).slice(0, 200)}"` : 'sem tema definido pelo cliente — escolha um, coerente com o negócio dele, sem repetir temas recentes';
        const fmtTxt = pl.formato === 'carrossel' ? `carrossel de ${pl.slides || '2 a 10'} slides` : 'peça única (feed)';
        const mensagemSintetica = `Pedido avulso confirmado pelo cliente com o Designer — não é uma proposta nova aguardando aprovação sua, já foi aprovado lá. Produza agora a direção completa (headline, subheadline, prova, CTA e ${pl.tema ? 'use o' : 'escolha o'} tema) para: ${temaTxt}, ${fmtTxt}. Emita a tag <conteudo> completa (com "avulso":true) já nesta resposta — não apresente a proposta de novo nem pergunte se está bom, a confirmação já aconteceu.`;
        const r = await fetch(`${base}/api/agente-chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
          body: JSON.stringify({ agente: 'estrategia', user_id: o.user_id, ordem_id: o.id, mensagem: mensagemSintetica }),
        });
        const d = await r.json().catch(() => null);
        LOG({ etapa: 'direcao-avulsa', orderId: o.id, userId: o.user_id, status: r.status, ok: !!(r.ok) });
        if (r.ok) direcoesAvulsas++;
        else console.error('[worker] direcao_avulso_criativo falhou — ordem=' + o.id + ' status=' + r.status + ' erro=' + String((d && d.error) || '').slice(0, 160));
      } catch (e) { console.error('[worker] direcao_avulso_criativo — exceção — ordem=' + o.id + ' erro=' + (e && e.message)); }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // COPY PARA CRIATIVO — elo único (15/set/2026, "Cadeia copy_para_criativo órfã", autorizado pelo
  // João — reaproveita INTEGRALMENTE o mecanismo acima, não duplica nada). Bloco PRÓPRIO, espelhando
  // o de DIREÇÃO AVULSA logo acima — mesmo formato de chamada (fetch a api/agente-chat com
  // x-internal-secret, ordem_id, user_id), mesma ausência de lock pendente→processando pelo MESMO
  // motivo (os relógios de _cadeia-lib.js só enxergam 'pendente'; ver comentário completo acima,
  // não repetido aqui). ÚNICA diferença estrutural: esta cadeia tem um elo só — o cliente já subiu
  // o criativo pronto, a Estratégia só escreve a copy e grava <conteudo> com "criativo_url" (NÃO
  // dispara nada ao Designer, ver instrução em api/agente-chat.js ~linha 446) — avancarCadeia já
  // fecha uma cadeia de 1 elo sem criar próximo elo nenhum (_cadeia-lib.js, "FECHAMENTO EXPLÍCITO"),
  // nenhuma mudança precisou ir lá.
  //
  // Antes desta correção: a ordem nascia (api/admin-users.js, ação `criar_os_copy`, quando o
  // cliente sobe um criativo pronto e pede legenda pelo formulário "Enviar Conteúdo") sem
  // `payload.cadeia` — nenhum job do cron a processava (grep confirmou: zero ocorrências de
  // 'copy_para_criativo' em todo este arquivo antes de hoje) e o próprio comentário do código em
  // api/admin-users.js admitia o desenho: "avisa que há uma ordem — o Estrategista atende quando
  // aberto" — dependia do cliente ou de alguém abrir o chat da Estratégia por conta própria, o que
  // não acontecia na prática. Mesmo problema que `direcao_avulso_criativo` tinha antes de hoje,
  // mesma correção.
  if (process.env.CRON_SECRET) {
    const pendCopy = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?tarefa=eq.copy_para_criativo&status=eq.pendente${soUid ? `&user_id=eq.${soUid}` : ''}&select=id,user_id,payload,detalhe&order=created_at.asc&limit=3`, { headers: SBH() }).then(r => r.json()).catch(() => []);
    for (const o of (Array.isArray(pendCopy) ? pendCopy : [])) {
      try {
        const pl = o.payload || {};
        // MENSAGEM SINTÉTICA — mesmo motivo do bloco de direção avulsa: sem este sinal explícito,
        // REGRAS_PEDIDO_AVULSO_ESTRATEGIA (injetada em TODO prompt de Estratégia, protegida, não
        // alterada) poderia levar o agente a "apresentar e perguntar" em vez de produzir direto —
        // aqui a confirmação já aconteceu no ato de o cliente subir o criativo e preencher o
        // formulário, não numa conversa que o worker precisaria retomar.
        const temaTxt = pl.tema ? `tema "${String(pl.tema).slice(0, 200)}"` : 'sem tema informado pelo cliente — escreva a copy a partir do que a arte mostra e do DNA da marca';
        const fmtTxt = pl.formato ? String(pl.formato).slice(0, 40) : 'feed';
        const dataTxt = pl.data_sugerida ? ` Data sugerida: ${pl.data_sugerida}.` : '';
        const mensagemSintetica = `Pedido de legenda confirmado — o cliente já subiu o criativo pronto (não é uma proposta nova aguardando aprovação sua) e quer só a copy para ele. Formato: ${fmtTxt}. ${temaTxt}.${dataTxt} URL do criativo: ${pl.criativo_url || '(ausente — verifique a ordem)'}. Escreva a copy completa (headline + legenda + hashtags + CTA) no tom da marca e emita a tag <conteudo> já nesta resposta, com "avulso":true e "criativo_url" preenchido com a URL exata acima — não pergunte nem apresente a proposta de novo, a confirmação já aconteceu. Não dispare nada ao Designer: o criativo já existe.`;
        const body = { agente: 'estrategia', user_id: o.user_id, ordem_id: o.id, mensagem: mensagemSintetica };
        // VISÃO (mesmo mecanismo de "Gerar copy com IA" no card de aprovação, api/agente-chat.js
        // `_blocoDeImagem`): quando o criativo é uma imagem, manda também pra Estratégia poder
        // olhar a arte real, não só o tema em texto. Vídeo fica de fora — `_blocoDeImagem` só lê
        // imagem (PNG/JPEG/GIF/WEBP, por sniff de bytes); pra vídeo a Estratégia trabalha só com
        // o tema/formato informados, igual já fazia antes desta rodada.
        if (pl.criativo_url && pl.criativo_tipo !== 'video') body.imagem_url = pl.criativo_url;
        const r = await fetch(`${base}/api/agente-chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => null);
        LOG({ etapa: 'copy-criativo', orderId: o.id, userId: o.user_id, status: r.status, ok: !!(r.ok) });
        if (r.ok) copiasCriativo++;
        else console.error('[worker] copy_para_criativo falhou — ordem=' + o.id + ' status=' + r.status + ' erro=' + String((d && d.error) || '').slice(0, 160));
      } catch (e) { console.error('[worker] copy_para_criativo — exceção — ordem=' + o.id + ' erro=' + (e && e.message)); }
    }
  }

  const pend = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?tarefa=in.(criar_post,criar_avulso,ficha_tecnica,criar_criativo_ads,substituir_criativo)&status=eq.pendente${soUid ? `&user_id=eq.${soUid}` : ''}&select=id,user_id,payload,total,detalhe&order=created_at.asc&limit=3`, { headers: SBH() }).then(r => r.json()).catch(() => []);

  for (const o of (Array.isArray(pend) ? pend : [])) {
    // TRAVA: só continua se ESTA execução conseguiu mudar pendente → processando
    const lock = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}&status=eq.pendente`, {
      method: 'PATCH', headers: { ...SBH(), 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: 'processando', payload: { ...limparErroAtivo(o.payload), batendo: new Date().toISOString(), worker: true } }),
    }).then(r => r.json()).catch(() => []);
    if (!Array.isArray(lock) || !lock.length) continue; // outro processo pegou antes
    LOG({ etapa: 'lock', orderId: o.id, userId: o.user_id, tarefa: o.tarefa });

    // posts-alvo: os ids aprovados na semana, ou os rascunhos com copy pronta
    const ids = (o.payload && Array.isArray(o.payload.ids)) ? o.payload.ids : null;
    // RECRIAÇÃO: o conteúdo JÁ tem imagem — não filtrar por midia_url nula, senão a ordem de
    // ajuste não encontra nada. O resultado sobrescreve o MESMO registro (sem card novo).
    const ehRecriacao = !!(o.payload && (o.payload.ajuste || o.payload.recriacao));
    // ETAPA 1 — DESCARTE REAL (25/ago/2026): a busca por payload.ids é por ID puro, sem filtro
    // de status — se um post referenciado por uma ordem pendente/processando for descartado
    // (status='excluido') DEPOIS que a ordem já existia, o worker ainda o encontrava e gerava
    // arte pra ele, gastando cota e ressuscitando algo que o usuário tinha acabado de excluir.
    // Não usa status=eq.rascunho aqui (quebraria recriação/ajuste, que operam em conteúdo que
    // JÁ tem imagem) — só exclui o estado terminal.
    const q = ids && ids.length
      ? `conteudos?id=in.(${ids.join(',')})&status=neq.excluido&select=id,tema,copy,formato,tipo_visual,meta,midia_url`
      : `conteudos?user_id=eq.${o.user_id}&status=eq.rascunho&midia_url=is.null&select=id,tema,copy,formato,tipo_visual,meta&limit=10`;
    // ORDEM AVULSA/RECORRENTE: não há posts no calendário — o alvo é o BRIEFING da ordem.
    //    Criamos o conteúdo do zero (mesma lógica da Estratégia: nasce vinculado e vai ao Aprovar).
    // NUNCA usar o.detalhe como conteúdo da arte: ele é o rótulo da tarefa ("Ajuste da arte: ...")
    // e acabava renderizado como headline. Só o briefing explícito do payload vale como tema.
    const brief = (o.payload && o.payload.brief) || '';
    const tf = String(o.tarefa || '');
    // ficha técnica e criativos de anúncio geram ARQUIVO (biblioteca), não post no calendário
    const soArquivo = (tf === 'ficha_tecnica' || tf === 'criar_criativo_ads' || tf === 'substituir_criativo');
    const ehBrief = !ids && !!brief && (soArquivo || (o.payload && (o.payload.recorrente || o.payload.itens)));
    let posts;
    if (soArquivo) {
      // gera a peça e registra na biblioteca; não cria conteúdo nem card de aprovação
      try {
        // CONTEUDO_ID JÁ DECIDIU O TEXTO (16/set/2026, "unificação das arquiteturas de prompt" —
        // ver o comentário em api/agente-chat.js, avanço da cadeia novo_criativo_ads): quando a
        // ordem carrega payload.ids, a Estratégia JÁ gravou headline/subheadline/prova/cta_arte
        // reais num <conteudo> antes deste elo nascer — busca esse registro e usa o texto real,
        // em vez de mandar o brief cru e deixar o Diretor inventar uma headline por cima de uma
        // decisão que já existe no banco (pior que ausência de headline: descarte de decisão).
        // SEM ids (ficha_tecnica, substituir_criativo, ou uma ordem de antes desta correção):
        // EXCEÇÃO NOMEADA — não há texto decidido em lugar nenhum para buscar; o Diretor segue
        // escrevendo a headline a partir do brief cru, comportamento anterior, inalterado.
        // permitir_invencao_headline:true (Etapa 1, 16/set/2026): sem ids (ou fetch abaixo falha),
        // este corpoImg não carrega headline nenhum — gerar-imagem.js agora recusa headline vazia
        // por padrão (validarTextoDaPeca); esta é uma das exceções nomeadas que autorizam o
        // Diretor a inventar, mesma categoria dos dois ramos de agentes.html.
        let corpoImg = { user_id: o.user_id, prompt: brief, tamanho: tf === 'ficha_tecnica' ? '1:1' : '4:5',
          tipo: 'conceitual', engine: tf === 'ficha_tecnica' ? false : undefined, permitir_invencao_headline: true };
        if (ids && ids.length) {
          try {
            const cRows = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: SBH() }).then(r => r.json()).catch(() => []);
            const c = Array.isArray(cRows) && cRows[0];
            if (c) {
              const meta = c.meta || {};
              // PRECEDÊNCIA (Etapa 1, 16/set/2026): headline é o texto DECIDIDO pela Estratégia;
              // tema é rótulo interno curto (ex.: "promo"). Headline primeiro, tema só de
              // fallback — e SEM permitir_invencao_headline aqui: se a Estratégia gravou o
              // conteúdo sem headline, é falha do caminho anterior, não exceção deste worker.
              corpoImg = { user_id: o.user_id, prompt: meta.headline || c.tema || brief,
                headline: meta.headline || '', subheadline: meta.subheadline || '', prova: meta.prova || '',
                cta_arte: meta.cta_arte || '', copy: c.copy || '', oferta: meta.oferta || '', pilar: c.pilar || '',
                formato: c.formato || 'feed', tipo: c.tipo_visual || 'conceitual',
                tamanho: tf === 'ficha_tecnica' ? '1:1' : '4:5', engine: tf === 'ficha_tecnica' ? false : undefined };
            } else {
              console.error('[worker] soArquivo — payload.ids presente mas conteudo não encontrado (excluído/id inválido?), seguindo com brief — ordem=' + o.id);
            }
          } catch (e) { console.error('[worker] soArquivo — falha ao buscar conteudo real por ids, seguindo com brief — ordem=' + o.id + ' erro=' + (e && e.message)); }
        }
        const r = await fetch(`${base}/api/gerar-imagem`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
          body: JSON.stringify(corpoImg),
        });
        const d = await r.json().catch(() => null);
        const ok = r.ok && d && d.url;
        await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, {
          method: 'PATCH', headers: SBH(),
          body: JSON.stringify({ status: ok ? 'concluida' : 'erro', progresso: ok ? 1 : 0, total: 1,
            payload: { ...limparErroAtivo(o.payload), batendo: new Date().toISOString(), worker: true, ...(ok ? { url: d.url } : { erros: [{ tema: tf, motivo: String((d && (d.error && (d.error.message||d.error))) || ('HTTP '+r.status)).slice(0,160) }] }) },
            ...(ok ? { concluida_em: new Date().toISOString() } : {}) }),
        }).catch(() => {});
        if (ok) artes++;
        // HANDOFF — CADEIA (11/set/2026): se esta ordem faz parte de uma cadeia (payload.cadeia
        // ou o formato antigo payload.sequencia — ver api/_cadeia-lib.js), fecha o elo atual e
        // cria o próximo automaticamente. É EXATAMENTE aqui que o 3º elo de novo_criativo_ads
        // nunca fechava (elo 2, criar_criativo_ads, sempre passou por este branch, e nada aqui
        // lia payload.sequencia/etapa até esta correção). Só avança em sucesso — falha PARA a
        // cadeia neste elo, preserva o que já foi produzido antes (não desfaz, não recomeça).
        if (ok) {
          try {
            await avancarCadeia({ id: o.id, user_id: o.user_id, detalhe: o.detalhe, payload: o.payload }, { tipo: 'arquivo_url', valor: d.url });
          } catch (e) { console.error('[cadeia-lib] avancarCadeia falhou (soArquivo) — ordem=' + o.id + ' erro=' + (e && e.message)); }
        }
      } catch (e) {}
      ordensFeitas++; continue;
    }
    if (ehBrief) {
      const itens = (o.payload.itens && o.payload.itens.length) ? o.payload.itens : [{ tema: brief, formato: 'feed', tipo_visual: 'conceitual' }];
      const amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const criados = await fetch(`${SUPABASE_URL}/rest/v1/conteudos`, {
        method: 'POST', headers: { ...SBH(), 'Prefer': 'return=representation' },
        body: JSON.stringify(itens.map(it => ({
          user_id: o.user_id, tema: it.tema || brief, copy: it.copy || '',
          formato: it.formato || 'feed', tipo_visual: it.tipo_visual || 'conceitual',
          data_sugerida: amanha, data_agendada: amanha + 'T09:00:00',
          status: 'rascunho', origem_agente: 'criativo',
          // FILA TÉCNICA — item 4 (09/set/2026): este era o único caminho do sistema que ainda
          // gravava `origem` nula em `conteudos` — todo o resto já migrou pra Falha 3 (ver
          // sql/falha3-passo1-coluna-origem.sql e a linha equivalente em api/agente-chat.js,
          // `origem:ct.avulso?'avulso':'plano'`). Este bloco, por construção, SÓ roda quando não
          // há posts de calendário e o alvo é o briefing da ordem (comentário "ORDEM
          // AVULSA/RECORRENTE" acima) — ou seja, é sempre avulso, nunca inferência.
          origem: 'avulso',
          meta: { headline: it.headline || it.tema || brief, subheadline: it.subheadline || '', cta_arte: it.cta_arte || '', pilar: it.pilar || '', avulso: true, ordem_id: o.id },
        }))),
      }).then(r => r.json()).catch(() => []);
      posts = Array.isArray(criados) ? criados : [];
    } else {
      posts = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: SBH() }).then(r => r.json()).catch(() => []);
    }
    posts = (Array.isArray(posts) ? posts : []).filter(c => {
      const temCopy = (ehBrief || ehRecriacao) ? true : JC.prontoParaArte(c);
      // já completo? (imagem única com arte, ou carrossel com todos os slides) → fora
      const pend = slidesFaltantes(c, (o.payload || {}).slide).faltam.length > 0;
      return temCopy && pend && !JC.ehMaterialUsuario(c);
    });

    let feitos = 0; const erros = [];
    let faltamNoFim = 0;                    // slides que continuaram pendentes nesta rodada
    // UNIDADES EXPLÍCITAS: 'feitos' conta SLIDES, então 'total' também precisa contar SLIDES.
    // Antes total = nº de conteúdos e o painel exibia "9/2". Agora: content_count vs slide_count.
    const contentCount = posts.length;
    const slideCount = posts.reduce((acc, c) => acc + slidesFaltantes(c, (o.payload || {}).slide).faltam.length, 0);
    for (const c of posts) {
      const m = c.meta || {};
      const alvo = slidesFaltantes(c, (o.payload || {}).slide);
      for (const nSlide of alvo.faltam) {    // carrossel: 1..N | ajuste: só o slide pedido
      try {
        // TEXTO EM VARIÁVEL PRÓPRIA (19/set/2026, "recusa por excesso de palavras desperdiça o
        // pedido inteiro"): antes eram literais direto no corpo do fetch. Precisam ser mutáveis
        // porque a correção abaixo substitui SÓ o campo que estourou o limite, antes da
        // retentativa — o resto do corpo (prompt, tipo, formato, slide etc.) nunca muda.
        let _headline = m.headline || '', _subheadline = m.subheadline || '', _cta_arte = m.cta_arte || '';
        const corpoGerarImagem = () => ({
          user_id: o.user_id, conteudo_id: c.id,
          // PRECEDÊNCIA (Etapa 1, 16/set/2026, "Engine — Etapas 1 e 2"): antes era
          // `c.tema || m.headline || 'post'` — o tema (rótulo interno, ex.: "promo", 5
          // caracteres) tinha prioridade sobre a headline de verdade (o texto decidido), e um
          // conteúdo sem tema nem headline ainda passava como o placeholder 'post'. Headline é
          // o texto decidido — vem primeiro; tema é só rótulo interno, fica de fallback; sem
          // nenhum dos dois, o campo fica vazio de propósito e a peça é recusada mais abaixo
          // (o gate de "Prompt inválido" já existente, ou validarTextoDaPeca em
          // gerar-imagem.js) — erro explícito, nunca mais um placeholder silencioso.
          prompt: _headline || c.tema || '', tamanho: '4:5',
          tipo: c.tipo_visual || 'conceitual', formato: c.formato || 'feed',
          headline: _headline, subheadline: _subheadline, prova: m.prova || '',
          cta_arte: _cta_arte, oferta: m.oferta || '', copy: c.copy || '', pilar: m.pilar || '',
          // regeneração controlada: mantém todo o contexto original e aplica só o pedido do cliente
          // cada geração carrega o slide e o total — gravarSlide monta meta.slides[] com isso
          slide: nSlide, total: alvo.tot,
          ...((o.payload && o.payload.ajuste) ? { ajuste: o.payload.ajuste, variacao: Number(o.payload.variacao || 30), reload: true } : {}),
        });
        let r = await fetch(`${base}/api/gerar-imagem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
          body: JSON.stringify(corpoGerarImagem()),
        });
        let d = await r.json().catch(() => null);
        LOG({ etapa: 'gerar-imagem', orderId: o.id, conteudoId: c.id, endpoint: '/api/gerar-imagem', status: r.status, ok: !!(d && (d.url || d.midia_url)) });

        // RECUSA POR EXCESSO DE PALAVRAS — REESCRITA ÚNICA (19/set/2026, autorizado pelo João,
        // item 3 da rodada "rosto/pessoa_conceito/reescrita/órfãos"): validarTextoDaPeca
        // (gerar-imagem.js, intocada — a validação em si não muda aqui) recusa a PEÇA INTEIRA
        // quando um campo passa do limite. Sem esta correção, o retry genérico abaixo
        // ('tentativas'/'erro', também intocado) só reenviava o MESMO texto inválido até esgotar
        // as 3 tentativas — o pedido morria sem o cliente nunca receber nada (caso real: subheadline
        // de 7 palavras, limite 6). Só este formato de mensagem — o que validarTextoDaPeca emite —
        // aciona a correção; qualquer outro erro (OpenAI fora do ar, rede, moderação) cai direto
        // no caminho de sempre, sem tocar nisto. UMA tentativa: se a reescrita também estourar, ou
        // o agente não responder com a tag, vira recusa de verdade daqui a duas linhas, motivo
        // visível — quem decide depois é o retry genérico de sempre, nunca esta correção de novo.
        // NÃO consome cota de imagem: a correção é uma chamada de TEXTO a /api/agente-chat (mesmo
        // mecanismo — x-internal-secret — de direcao_avulso_criativo/copy_para_criativo, acima
        // neste arquivo); a cota de imagem só é debitada dentro de gerar-imagem.js DEPOIS que a
        // imagem sai da OpenAI (uso.imagens++, bem no fim da função, intocado) — nunca chega lá
        // enquanto a validação recusa. NENHUMA REGRA DUPLICADA: o limite de palavras não é
        // reconferido aqui — quem valida de novo é a PRÓPRIA validarTextoDaPeca, na retentativa a
        // /api/gerar-imagem, exatamente como validaria qualquer chamada normal. Handler da tag
        // <correcao_texto> em api/agente-chat.js — canal próprio, separado de <detalhe> de
        // propósito (ver comentário lá: <detalhe> tem duas travas que engoliriam esta correção em
        // silêncio e não podem ser alteradas).
        const _erroTxt = !r.ok ? String((d && (d.error && (d.error.message || d.error.error || d.error))) || '') : '';
        const _matchLimite = _erroTxt.match(/^(headline|subheadline|cta_arte) com \d+ palavras \(limite do Engine: (\d+)\)/);
        if (!r.ok && _matchLimite && process.env.CRON_SECRET) {
          const _campo = _matchLimite[1];
          const _limite = _matchLimite[2];
          const _textoAtual = _campo === 'headline' ? _headline : _campo === 'subheadline' ? _subheadline : _cta_arte;
          try {
            const mensagemCorrecao = `A peça (conteúdo id=${c.id}) foi recusada pela validação de texto: "${_erroTxt}". Reescreva SOMENTE o campo "${_campo}", mantendo o sentido, em até ${_limite} palavras. Texto atual: "${_textoAtual}". Responda emitindo exatamente esta tag, sem nenhum outro texto na resposta: <correcao_texto>{"id":"${c.id}","campo":"${_campo}","valor":"TEXTO NOVO AQUI"}</correcao_texto>`;
            const rCorr = await fetch(`${base}/api/agente-chat`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
              body: JSON.stringify({ agente: 'estrategia', user_id: o.user_id, ordem_id: o.id, mensagem: mensagemCorrecao }),
            });
            const dCorr = await rCorr.json().catch(() => null);
            const _corr = (dCorr && Array.isArray(dCorr.correcoes_texto)) ? dCorr.correcoes_texto.find(x => String(x.id) === String(c.id) && x.campo === _campo) : null;
            LOG({ etapa: 'correcao-texto', orderId: o.id, conteudoId: c.id, campo: _campo, status: rCorr.status, ok: !!_corr });
            if (_corr && String(_corr.valor || '').trim()) {
              if (_campo === 'headline') _headline = String(_corr.valor).trim();
              else if (_campo === 'subheadline') _subheadline = String(_corr.valor).trim();
              else _cta_arte = String(_corr.valor).trim();
              r = await fetch(`${base}/api/gerar-imagem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET },
                body: JSON.stringify(corpoGerarImagem()),
              });
              d = await r.json().catch(() => null);
              LOG({ etapa: 'gerar-imagem-apos-correcao', orderId: o.id, conteudoId: c.id, status: r.status, ok: !!(d && (d.url || d.midia_url)) });
            }
          } catch (e) { console.error('[worker] correcao-texto — exceção — ordem=' + o.id + ' conteudo=' + c.id + ' erro=' + (e && e.message)); }
        }

        if (!r.ok || !d || !(d.url || d.midia_url)) { faltamNoFim++; erros.push({ tema: (c.tema || 'post') + (alvo.tot > 1 ? ` (slide ${nSlide}/${alvo.tot})` : ''), motivo: String((d && (d.error && (d.error.message || d.error.error || d.error))) || ('HTTP ' + r.status)).slice(0,160) }); continue; }
        await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${c.id}`, {
          method: 'PATCH', headers: SBH(),
          // só o slide 1 (capa) escreve midia_url aqui; os demais já foram gravados em
          // meta.slides[] pelo gravarSlide() do gerar-imagem (mecanismo existente, não duplicado)
          body: JSON.stringify(nSlide === 1
            ? (ehRecriacao ? { midia_url: (d.url||d.midia_url) } : { midia_url: (d.url||d.midia_url), status: 'aguardando_aprovacao' })
            : (ehRecriacao ? {} : { status: 'aguardando_aprovacao' })),
        }).catch(() => {});
        feitos++; artes++;
        await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, {
          method: 'PATCH', headers: SBH(),
          body: JSON.stringify({ progresso: feitos, total: slideCount, payload: { ...limparErroAtivo(o.payload), batendo: new Date().toISOString(), worker: true, content_count: contentCount, slide_count: slideCount, completed_slide_count: feitos } }),
        }).catch(() => {});
      } catch (e) { faltamNoFim++; erros.push({ tema: (c.tema || 'post') + (alvo.tot > 1 ? ` (slide ${nSlide}/${alvo.tot})` : ''), motivo: String(e && e.message || e).slice(0,160) }); }
      }
    }

    const tent = Number((o.payload || {}).tentativas || 0) + (feitos > 0 ? 0 : 1);
    const pl = { ...limparErroAtivo(o.payload), batendo: new Date().toISOString(), worker: true, tentativas: tent, content_count: contentCount, slide_count: slideCount, completed_slide_count: feitos };
    if (erros.length) pl.erros = erros;   // erro ATIVO só se ESTA tentativa falhou
    // RETRY COM LIMITE: falhou e ainda há tentativa? volta para a fila. Esgotou (3)? vira 'erro'
    // com o motivo visível — nunca fica preso em 'processando' nem some silenciosamente.
    // FALHA PARCIAL: carrossel só é 'concluida' se TODOS os slides saíram. Se faltou algum,
    // volta para a fila (retry) e a retomada gera apenas o que falta — nunca o que já existe.
    const estadoFinal = (!posts.length) ? 'concluida'
      : (faltamNoFim === 0 && feitos > 0) ? 'concluida'
      : (tent < 3 ? 'pendente' : 'erro');
    await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, {
      method: 'PATCH', headers: SBH(),
      body: JSON.stringify({
        status: (LOG({ etapa: 'fim', orderId: o.id, tentativa: tent, conteudos: contentCount, slides: slideCount, feitos, resultado: estadoFinal }), estadoFinal),
        progresso: feitos, total: slideCount, payload: pl,
        ...(feitos > 0 ? { concluida_em: new Date().toISOString() } : {}),
      }),
    }).catch(() => {});
    ordensFeitas++;
    // HANDOFF — CADEIA (11/set/2026): mesmo mecanismo do branch soArquivo, acima (ver ali pro
    // comentário completo). Nenhuma cadeia usa este caminho hoje — novo_criativo_ads passa
    // inteira pelo soArquivo — fica pronto pra qualquer cadeia futura cujo elo produza post de
    // calendário em vez de arquivo avulso ("vale para qualquer cadeia, não só para esta").
    if (estadoFinal === 'concluida') {
      try {
        await avancarCadeia({ id: o.id, user_id: o.user_id, detalhe: o.detalhe, payload: o.payload }, { tipo: 'conteudo_ids', valor: posts.map(p => p.id) });
      } catch (e) { console.error('[cadeia-lib] avancarCadeia falhou (loop principal) — ordem=' + o.id + ' erro=' + (e && e.message)); }
    }
  }
  return { ordens: ordensFeitas, artes, direcoes_avulsas: direcoesAvulsas, copias_criativo: copiasCriativo };
}

async function jobOrdens() {
  // EXPIRAÇÃO: ordem pendente há mais de 7 dias não é mais "atual" (sobra de testes/onboardings
  // antigos). Sai da fila viva e vai para o histórico como 'expirada', com o motivo registrado —
  // o dado é preservado, não apagado nem escondido no frontend.
  try {
    const corte = new Date(Date.now() - 7 * 864e5).toISOString();
    const velhas = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?status=in.(pendente,aguardando_aprovacao)&created_at=lt.${corte}&select=id,payload,tarefa&limit=200`, { headers: SBH() }).then(r => r.json()).catch(() => []);
    for (const v of (Array.isArray(velhas) ? velhas : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${v.id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ status: 'expirada', payload: { ...(v.payload || {}), motivo_expiracao: 'Sem execução por mais de 7 dias' } }),
      }).catch(() => {});
    }
  } catch (e) {}

  // Lembrete barato (sem IA): avisa usuários com ordens pendentes + ativa recorrentes do dia
  // FILA TÉCNICA — item 3 (09/set/2026): eram `new Date()` crus (UTC). `hoje` trocado por
  // `JC.hojeISOBrasil()`; `diaDoMes`/`diaSemana` derivados do MESMO `hoje` (nunca recalculados
  // separadamente — evitaria reintroduzir a mesma divergência entre dois cálculos de "hoje" que
  // este item inteiro existe para eliminar), lendo os campos como UTC puro (nunca reinterpretar
  // por um terceiro fuso — ver `_hojeSPComoData` no topo do arquivo).
  const hoje = JC.hojeISOBrasil();
  const _hojeData = _hojeSPComoData(hoje);
  const diaDoMes = _hojeData.getUTCDate();
  const diaSemana = _hojeData.getUTCDay(); // 0=domingo
  let lembretes = 0, recCriadas = 0;

  // 1) Ordens recorrentes: gera a ordem do ciclo (1x por período) com anti-duplicata
  // FILA TÉCNICA — item 2 (09/set/2026): bloco não tinha try/catch próprio — uma exceção aqui
  // (ex.: erro de rede na 1ª chamada) abortava a função inteira via o catch genérico do topo,
  // e o drip semanal (bloco 1.5, abaixo) nunca chegava a rodar, sem nenhum log que apontasse
  // qual dos dois blocos falhou. Mesmo padrão de isolamento que EXPIRAÇÃO e WATCHDOG (acima) já
  // tinham — estendido aos dois blocos que faltavam.
  try {
    const recorrentes = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?recorrencia=not.is.null&select=*`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
    for (const o of (Array.isArray(recorrentes) ? recorrentes : [])) {
      // REGRAS DE RECORRÊNCIA (o dia é calculado, não adivinhado):
      //  mensal        → dia 1
      //  primeira_seg  → 1ª segunda-feira do mês (diaDoMes 1..7 numa segunda)
      //  semanal       → toda segunda
      //  quinzenal     → dias 1 e 15
      //  dia_mes:N     → todo dia N
      const rec = String(o.recorrencia || '');
      let deveDisparar = false;
      if (rec === 'mensal') deveDisparar = (diaDoMes === 1);
      else if (rec === 'primeira_seg') deveDisparar = (diaSemana === 1 && diaDoMes <= 7);
      else if (rec === 'semanal') deveDisparar = (diaSemana === 1);
      else if (rec === 'quinzenal') deveDisparar = (diaDoMes === 1 || diaDoMes === 15);
      else if (rec.indexOf('dia_mes:') === 0) deveDisparar = (diaDoMes === Number(rec.split(':')[1] || 0));
      if (!deveDisparar) continue;
      if (o.ultimo_lembrete === hoje) continue; // já disparou hoje

      // A ordem do ciclo nasce PRONTA PARA PRODUÇÃO AUTOMÁTICA quando é peça de arte:
      // vira 'criar_avulso' com o briefing → o worker gera → a arte cai no Aprovar.
      // (Ordens que não são arte seguem como tarefa do usuário, com lembrete.)
      const ehArte = (o.para_agente === 'criativo');
      const nova = ehArte
        ? { user_id: o.user_id, de_agente: 'usuario', para_agente: 'criativo', tarefa: 'criar_avulso',
            detalhe: o.detalhe, status: 'pendente', total: 1, progresso: 0, ordem_pai: o.id,
            payload: { brief: o.detalhe, recorrente: true, itens: [{ tema: o.detalhe, formato: 'feed', tipo_visual: 'conceitual' }] } } // recorrente: o texto da tarefa É o briefing definido pelo usuário
        : { user_id: o.user_id, de_agente: 'usuario', para_agente: o.para_agente, tarefa: 'tarefa_usuario',
            detalhe: o.detalhe, status: 'pendente', ordem_pai: o.id };
      await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
        method: 'POST', headers: SBH(), body: JSON.stringify(nova),
      }).catch(()=>{});
      await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, { method: 'PATCH', headers: SBH(), body: JSON.stringify({ ultimo_lembrete: hoje }) }).catch(()=>{});
      recCriadas++;
    }
  } catch (e) { console.error('[jobOrdens] bloco 1 (ordens recorrentes) falhou:', e.message); }

  // 1.5) DRIP SEMANAL (Fase 1, 25/ago/2026 — ANCORAGEM DAS SEMANAS, item 6, 28/ago/2026): no dia
  //      de lote de cada usuário, cria a tarefa do Criativo só com os posts DAQUELA semana ainda
  //      sem arte. Evita gerar o mês todo de uma vez. Job já existia com deduplicação — só a
  //      JANELA e a ANTECEDÊNCIA mudaram (pedido explícito: "ajustar a janela e a antecedência,
  //      não recriar"):
  //      • JANELA: antes disparava NO PRÓPRIO dia_lote e varria [hoje, hoje+7) — hoje o dia_lote
  //        é a definição de "em que dia a semana COMEÇA" (Configurações → Ciclo de produção;
  //        segunda é só o padrão, não mais uma regra fixa — ver assets/classificacao.js).
  //      • ANTECEDÊNCIA: o card agora nasce 3 DIAS ANTES do início da semana, não no início dela
  //        — o usuário precisa de tempo pra aprovar antes da semana realmente começar (exemplo
  //        dado: dia_lote=quarta → card nasce domingo). Semana 1 fica de fora deste job: ela já
  //        nasce direto em aprovar.html, junto da aprovação mensal — não pode ser antecipada
  //        (não existe "3 dias antes" de um evento que ainda não aconteceu).
  let lotesSemana = 0, lotesSemanaConsultaFalhou = 0;
  // FILA TÉCNICA — item 2 (09/set/2026): bloco isolado em try/catch próprio, mesmo motivo do
  // bloco 1 acima — sem isso, uma exceção aqui também abortava a função inteira (e o resto de
  // jobOrdens, abaixo — resgate de órfã, lembretes, conversão de trial — nunca rodava).
  try {
  // CAUSA COMUM (07/set/2026, ver APRENDIZADOS.md): esta consulta e a de jobExpiracaoSemana eram
  // duas cópias literais da mesma regra, cada uma com seu próprio catch silencioso — Família 2 +
  // Família 1 juntas. Unificada em clientesElegiveisSemana (api/_semana-lib.js).
  const ativos = await clientesElegiveisSemana(KEY());
  // FILA TÉCNICA — item 3 (09/set/2026): `daqui3` era um `new Date()` cru INDEPENDENTE de `hoje`
  // (linha ~779) — dois cálculos de "agora" no mesmo job, cada um no seu próprio fuso do processo
  // (UTC). Agora deriva do MESMO `_hojeData` (já resolvido pro calendário de SP) — fecha a mesma
  // pergunta respondida duas vezes (Família 2) E elimina, de brinde, a janela teórica de dois
  // `new Date()` lidos em instantes ligeiramente diferentes dentro do mesmo job. É ESTE cálculo
  // que alimenta o casamento com `dia_lote` do cliente (linha do `if (diaSemanaDaqui3 !== dl)`
  // abaixo) — verificado numericamente que não muda qual dia é considerado nos horários reais de
  // disparo do cron (ver /tmp/test_frente_datas_cron.js, 730 dias, 0 divergências).
  const daqui3 = new Date(_hojeData.getTime() + 3 * 864e5);
  const diaSemanaDaqui3 = daqui3.getUTCDay(); // 0=domingo..6=sábado
  const iniSemISO = daqui3.toISOString().slice(0, 10); // se hoje+3 cair no dia_lote, ESSE é o início da próxima semana
  const fimSemISO = new Date(daqui3.getTime() + 6*864e5).toISOString().slice(0, 10);
  for (const c of (Array.isArray(ativos) ? ativos : [])) {
    const dl = (c.preferencias && Number.isInteger(c.preferencias.dia_lote)) ? c.preferencias.dia_lote : 1; // padrão segunda
    if (diaSemanaDaqui3 !== dl) continue; // só dispara 3 dias antes do início da semana deste cliente
    // FILA TÉCNICA — item 1 (09/set/2026): era `.then(r=>r.json()).catch(()=>[])` — "a consulta
    // falhou" e "não há rascunho nenhum na janela" caíam no mesmo `[]`, indistinguíveis. Foi
    // exatamente essa lacuna que custou duas rodadas de diagnóstico em 08/09 (o drip não criou o
    // card e não deu nenhum motivo). Mesmo padrão de clientesElegiveisSemana (api/_semana-lib.js):
    // checagem explícita de `r.ok`, log com status+motivo só quando falha de verdade — lista
    // vazia legítima (consulta OK, sem rascunho na janela) continua sem logar nada.
    let daSemana;
    try {
      const rDaSemana = await fetch(`${SUPABASE_URL}/rest/v1/conteudos?user_id=eq.${c.id}&status=eq.rascunho&midia_url=is.null&data_sugerida=gte.${iniSemISO}&data_sugerida=lte.${fimSemISO}&select=id&limit=50`, { headers: SBH() });
      if (!rDaSemana.ok) {
        let motivo = ''; try { const j = await rDaSemana.json(); motivo = j.message || j.hint || j.details || JSON.stringify(j).slice(0, 200); } catch (e) {}
        console.error('[jobOrdens] drip semanal: consulta de daSemana falhou — status=' + rDaSemana.status + ' motivo=' + String(motivo).slice(0, 200) + ' user=' + c.id);
        lotesSemanaConsultaFalhou++;
        continue;
      }
      daSemana = await rDaSemana.json();
    } catch (e) {
      console.error('[jobOrdens] drip semanal: consulta de daSemana falhou (rede) — user=' + c.id + ' erro=' + (e && e.message));
      lotesSemanaConsultaFalhou++;
      continue;
    }
    if (!Array.isArray(daSemana) || !daSemana.length) continue; // legítimo: consulta OK, sem rascunho na janela — nada a fazer, não é falha
    // REGRA DE NEGÓCIO: a ESTRATÉGIA SEMANAL é o gatilho — nunca produzimos direto. 3 dias antes
    // do início do ciclo (dia_lote) criamos o CARD DE APROVAÇÃO da semana; a produção só começa
    // quando o usuário aprovar no Aprovar (1ª aprovação). Dedup + INSERT agora vêm de
    // garantirCardAprovarSemana (api/_semana-lib.js) — mesma regra de sempre (se a Semana 1,
    // criada em aprovar.html, ou outra semana já estiver aberta, pula e tenta de novo no próximo
    // dia_lote), só que num lugar único, compartilhado com api/agente-chat.js.
    const ids = daSemana.map(x => x.id);
    const _g = await garantirCardAprovarSemana(KEY(), c.id, ids, 'estrategia', { precisa_detalhar: true });
    // REPARO AVULSO (05/set/2026): antes este contador somava mesmo quando o INSERT falhava em
    // silêncio (fetch sem checar .ok, achado na varredura da Família 1) — agora só conta quando
    // o card foi de fato criado.
    if (_g.criado) lotesSemana++;
  }
  } catch (e) { console.error('[jobOrdens] bloco 1.5 (drip semanal) falhou:', e.message); }

  // 2) Lembrete: para cada usuário com ordens pendentes, cria 1 recado (anti-duplicata por dia)
  const pend = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?status=eq.pendente&select=user_id`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
  const porUser = {};
  for (const p of (Array.isArray(pend) ? pend : [])) { porUser[p.user_id] = (porUser[p.user_id] || 0) + 1; }
  const tag = 'ord-' + hoje;
  for (const uid of Object.keys(porUser)) {
    const existe = await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${uid}&tipo=eq.ordens&mensagem=like.*${tag}*&select=id&limit=1`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
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

  return { recorrentes_criadas: recCriadas, lotes_semana: lotesSemana, lotes_semana_consulta_falhou: lotesSemanaConsultaFalhou, lembretes, convertidos };
}

// FILA TÉCNICA — item 1 (15/set/2026): WATCHDOG e RESGATE DE ÓRFÃ viviam dentro de jobOrdens,
// que só roda 1x/dia (vercel.json, 0 8 * * *) — um post preso em 'processando' logo depois desse
// horário só era resgatado no dia seguinte, quase 24h depois, mesmo o próprio código já
// considerando-o "morto" bem antes disso (8min/1h, ver limiares abaixo). Extraídos para uma
// função própria, com cron DEDICADO e frequência intermediária (job=resgate, ver vercel.json) —
// não junto de jobProduzir (a cada 5min) para não herdar, numa rota já afinada pra outra
// responsabilidade, o custo de varrer 'processando' de TODOS os clientes 96x mais vezes por dia
// (jobProduzir já é chamado com muito mais frequência por motivo diferente — produção, não
// vigilância). LÓGICA INTERNA DOS DOIS BLOCOS — INTOCADA, só mudou de lugar: cada `try/catch`
// abaixo é o texto exato que estava em jobOrdens, sem nenhuma linha de comportamento alterada.
async function jobResgateOrfas() {
  // WATCHDOG: ordens presas em 'processando' (navegador fechou no meio da geração) voltam para
  // 'pendente' — assim podem ser retomadas, em vez de ficarem travadas para sempre. A geração
  // marca payload.batendo com um timestamp; sem sinal de vida há +8min, destravamos.
  try {
    const travadas = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?status=eq.processando&select=id,payload&limit=100`, { headers: SBH() }).then(r=>r.json()).catch(()=>[]);
    const agora = Date.now();
    for (const o of (Array.isArray(travadas) ? travadas : [])) {
      const batendo = (o.payload && o.payload.batendo) ? new Date(o.payload.batendo).getTime() : 0;
      if (!batendo || (agora - batendo) > 8*60*1000) {
        await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, { method:'PATCH', headers: SBH(), body: JSON.stringify({ status:'pendente' }) }).catch(()=>{});
      }
    }
  } catch (e) {}

  // 1.9) RESGATE DE ÓRFÃ — bug achado ao ler o schema, não o código.
  //      `executarLoteCriativos` marca a ordem como 'processando'. Se o navegador fechar no
  //      meio (ou a função estourar os 60s), ela fica 'processando' PARA SEMPRE: a fila busca
  //      só 'pendente', então a ordem some da tela e nunca mais roda — em silêncio.
  //      CRITÉRIO = payload.batendo (heartbeat), NUNCA created_at: created_at é a hora da
  //      CRIAÇÃO. Uma ordem criada ontem e iniciada há 2min tem created_at antigo — por
  //      created_at ela seria ressuscitada NO MEIO DO VOO e o lote rodaria DUAS VEZES,
  //      queimando a cota em dobro. O heartbeat diz quando ela mexeu pela última vez.
  //      progresso/total já existem no schema: a retomada continua de onde parou.
  //      FILA (15/set/2026): esta consulta não tem `&limit=`, ao contrário do WATCHDOG acima
  //      (limit=100) — risco de escala independente da frequência do job, não corrigido aqui
  //      (fora do escopo pedido) — registrado na fila de limpeza futura (ver APRENDIZADOS.md).
  let orfas = 0;
  const LIMITE_MS = 3600e3; // 1h sem bater o coração = morreu
  try {
    const travadas = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?status=eq.processando&select=id,payload,created_at,progresso,total`, { headers: SBH() }).then(r => r.json());
    for (const o of (Array.isArray(travadas) ? travadas : [])) {
      // sem heartbeat = ordem antiga, de antes desta versão: cai no created_at como último recurso.
      const marca = ((o.payload || {}).batendo) || o.created_at;
      if (!marca || (Date.now() - new Date(marca).getTime()) < LIMITE_MS) continue; // ainda viva: não encosta
      await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${o.id}`, {
        method: 'PATCH', headers: SBH(),
        // mesma regra: ao devolver para a fila, o erro da tentativa anterior sai do estado ATIVO
        // e é arquivado em 'historico' (auditoria preservada).
        body: JSON.stringify({ status: 'pendente', payload: (() => {
          const pl = { ...(o.payload || {}) };
          if (Array.isArray(pl.erros) && pl.erros.length) {
            const h = Array.isArray(pl.historico) ? pl.historico.slice(-9) : [];
            h.push({ em: new Date().toISOString(), tentativa: Number(pl.tentativas || 0), erros: pl.erros });
            pl.historico = h;
          }
          delete pl.erros;
          return { ...pl, batendo: null, resgatada_em: new Date().toISOString() };
        })() }),
      }).catch(() => {});
      orfas++;
    }
  } catch (e) { console.error('resgate de orfa:', e.message); }

  return { orfas_resgatadas: orfas };
}

async function jobExpiracaoSemana() {
  // LOTE 2 — item 5 (semana não cumulativa, com vencimento, 01/set/2026 — ver APRENDIZADOS.md,
  // "LOTE 2"). Decisão explícita do produto: uma semana que passa NÃO acumula — o que não foi
  // aprovado dentro dela expira, em vez de continuar disponível pra sempre (era a recomendação
  // "cumulativa" da rodada anterior, revista e substituída por esta).
  // DUAS FASES, cada uma com seu próprio gatilho — não confundir uma com a outra:
  //   FASE 1 (expira): conteúdo ainda não decidido pelo cliente, cuja SEMANA fechou OU cuja
  //     própria DATA já passou, vira 'expirado' (JC.STATUS_EXPIRADO). Só toca no que ainda está
  //     pendente (rascunho/proposto/aguardando_aprovacao/aguardando_copy/aguardando_material) —
  //     nunca em algo já aprovado, publicado ou já excluído. Dois gatilhos independentes, OU
  //     entre eles (qualquer um já expira):
  //     (a) DATA: data_agendada (se houver) ou data_sugerida já passou.
  //     (b) SEMANA: a janela (JC.semanaDoPost/janelasSemanas, mesma fonte única de sempre) à qual
  //         o post pertence já fechou (fim da janela < hoje) — pega o caso em que a data isolada
  //         do post, por algum motivo (reagendamento anterior que não trocou de semana, borda de
  //         fuso), ainda não parecia vencida sozinha. Post sem semana válida (avulso, ou fora do
  //         horizonte de 5 semanas — JC.semanaDoPost retorna null) fica de fora, mesmo critério
  //         que travaDeDatas/travaTrial (agente-chat.js) já usam.
  //   FASE 2 (exclui): conteúdo 'expirado' há mais de JC.DIAS_AUTO_EXCLUSAO_EXPIRADO dias vira
  //     'excluido' — SOFT DELETE (o mesmo status que o resto do sistema já usa pra remoção,
  //     nunca um DELETE físico — mesmo precedente de jobOrdens/'expirada': dado preservado, nunca
  //     apagado de verdade). Reagendar (aprovar.html, função reagendar()) tira o post de
  //     'expirado' e zera expirado_em — reseta a contagem de 30 dias, exatamente como pedido.
  let expirados = 0, excluidosAutomaticos = 0;
  const hoje = JC.hojeISOBrasil();
  try {
    // CAUSA COMUM (07/set/2026, ver APRENDIZADOS.md): esta consulta e a do drip semanal
    // (jobOrdens) eram duas cópias literais da mesma regra, cada uma com seu próprio catch
    // silencioso — Família 2 + Família 1 juntas. Unificada em clientesElegiveisSemana
    // (api/_semana-lib.js).
    const clientesAtivos = await clientesElegiveisSemana(KEY());
    for (const c of (Array.isArray(clientesAtivos) ? clientesAtivos : [])) {
      const ancora = (c.preferencias && c.preferencias.plano_ancora_em) || null;
      if (!ancora) continue; // sem plano aprovado ainda: nenhuma semana definida, nada a expirar
      const dl = (c.preferencias && c.preferencias.dia_lote);
      const janelas = JC.janelasSemanas(ancora, dl);
      const pendentes = await fetch(`${SUPABASE_URL}/rest/v1/conteudos?user_id=eq.${c.id}&status=in.(rascunho,proposto,aguardando_aprovacao,aguardando_copy,aguardando_material)&data_sugerida=not.is.null&select=id,status,data_sugerida,data_agendada,meta&limit=500`, { headers: SBH() }).then(r => r.json()).catch(() => []);
      for (const p of (Array.isArray(pendentes) ? pendentes : [])) {
        const dataRef = String(p.data_agendada || p.data_sugerida || '').slice(0, 10);
        if (!dataRef) continue;
        const semana = JC.semanaDoPost(p.data_sugerida, ancora, dl);
        const janela = (semana != null) ? janelas[semana - 1] : null;
        const venceuPelaData = dataRef < hoje;
        const venceuPelaSemana = janela ? (janela.fim < hoje) : false;
        if (!venceuPelaData && !venceuPelaSemana) continue;
        await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${p.id}`, {
          method: 'PATCH', headers: SBH(),
          body: JSON.stringify({
            status: JC.STATUS_EXPIRADO, expirado_em: new Date().toISOString(),
            meta: { ...(p.meta || {}), status_pre_expiracao: p.status, motivo_expiracao: venceuPelaSemana ? 'semana encerrada' : 'data passada' },
          }),
        }).catch(() => {});
        expirados++;
      }
    }
  } catch (e) { console.error('jobExpiracaoSemana (fase 1 — expirar):', e && e.message); }

  try {
    const corteExclusao = new Date(Date.now() - JC.DIAS_AUTO_EXCLUSAO_EXPIRADO * 24 * 60 * 60 * 1000).toISOString();
    const vencidos = await fetch(`${SUPABASE_URL}/rest/v1/conteudos?status=eq.${JC.STATUS_EXPIRADO}&expirado_em=lt.${corteExclusao}&select=id,meta&limit=500`, { headers: SBH() }).then(r => r.json()).catch(() => []);
    for (const v of (Array.isArray(vencidos) ? vencidos : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/conteudos?id=eq.${v.id}`, {
        method: 'PATCH', headers: SBH(),
        body: JSON.stringify({ status: 'excluido', meta: { ...(v.meta || {}), motivo_exclusao: 'expirado há mais de ' + JC.DIAS_AUTO_EXCLUSAO_EXPIRADO + ' dias sem aprovação nem reagendamento' } }),
      }).catch(() => {});
      excluidosAutomaticos++;
    }
  } catch (e) { console.error('jobExpiracaoSemana (fase 2 — auto-excluir):', e && e.message); }

  return { expirados, excluidos_automaticos: excluidosAutomaticos };
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
    if (job === 'produzir') {
      // aceita disparo do próprio usuário (autenticado) além do cron — a produção começa na hora
      // em vez de esperar a próxima janela de 5 minutos.

      const r = await jobProduzir();
      // HANDOFF — CADEIA (11/set/2026): timeout de passagem/prazo total roda como passo IRMÃO
      // deste job — nunca dentro de jobProduzir() — pra não alterar nada do worker de produção
      // em si (lock/retry/watchdog ficam exatamente como estavam). Ver api/_cadeia-lib.js.
      let cadeia = {};
      try { cadeia = await verificarTimeoutCadeia(); } catch (e) { console.error('[cadeia-lib] verificarTimeoutCadeia falhou:', e.message); }
      return res.status(200).json({ ok: true, job, ...r, cadeia });
    }
    if (job === 'ordens') {
      const r = await jobOrdens();
      return res.status(200).json({ ok: true, job, ...r });
    }
    // FILA TÉCNICA — item 1 (15/set/2026): watchdog + resgate de órfã, extraídos de jobOrdens
    // (que só roda 1x/dia) para cron próprio, frequência intermediária — ver jobResgateOrfas().
    if (job === 'resgate') {
      const r = await jobResgateOrfas();
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
    if (job === 'expiracao') {
      // LOTE 2 — item 5 (semana não cumulativa, com vencimento, 01/set/2026): ver jobExpiracaoSemana.
      const r = await jobExpiracaoSemana();
      return res.status(200).json({ ok: true, job, ...r });
    }
    return res.status(400).json({ error: 'job inválido (use ?job=estrategia, produzir, tokens, seguranca, ordens, resgate, publicar, limpeza ou expiracao)' });
  } catch (e) {
    console.error('cron:', e.message);
    return res.status(500).json({ error: 'falha no cron', job });
  }
};
