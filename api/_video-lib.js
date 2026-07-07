// api/_video-lib.js — lógica compartilhada do Editor de Vídeo (Shotstack)
// Usado por video-editar.js e admin-users.js. NÃO é uma serverless function
// (não tem handler), então não conta no limite de 12 funções da Vercel.

const SHOTSTACK_BASE = 'https://api.shotstack.io';

function shotEnv() {
  return process.env.SHOTSTACK_ENV || 'stage'; // 'stage' (sandbox) | 'v1' (produção)
}
function shotHeaders() {
  return { 'x-api-key': process.env.SHOTSTACK_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };
}

// ═══════════════════════════════════════════════════════════════
// ZAPCAP — API principal do Editor (legenda viral PT + cortar silêncio + b-roll)
// Fluxo: upload (URL) → task → poll → downloadUrl. Doc: platform.zapcap.ai
// ═══════════════════════════════════════════════════════════════
const ZAPCAP_BASE = 'https://api.zapcap.ai';
// template padrão (estilo de legenda). João pode trocar depois vendo GET /templates.
const ZAPCAP_TEMPLATE_PADRAO = process.env.ZAPCAP_TEMPLATE_ID || 'a51c5222-47a7-4c37-b052-7b9853d66bf6';

function zapHeaders() {
  return { 'x-api-key': process.env.ZAPCAP_API_KEY, 'Content-Type': 'application/json' };
}

// 1. Upload do vídeo por URL (a URL pública do nosso Supabase). Retorna { videoId } | { error }.
async function zapUpload(videoUrl) {
  const r = await fetch(`${ZAPCAP_BASE}/videos/url`, {
    method: 'POST', headers: zapHeaders(),
    body: JSON.stringify({ url: videoUrl }),
  });
  const d = await r.json();
  if (!r.ok) return { error: (d && (d.detail || (d.errors && d.errors[0] && d.errors[0].detail) || JSON.stringify(d))) || 'erro no upload ZapCap' };
  const videoId = d && (d.id || d.videoId);
  if (!videoId) return { error: 'ZapCap sem videoId: ' + JSON.stringify(d).slice(0, 150) };
  return { videoId };
}

// 2. Cria a task de legenda/edição. Mapeia nossas opções → parâmetros ZapCap.
// Busca o primeiro template real da conta (fallback quando nenhum foi escolhido)
async function zapPrimeiroTemplate() {
  try {
    const r = await fetch(`${ZAPCAP_BASE}/templates`, { headers: zapHeaders() });
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.templates || d.data || []);
    return arr[0] && arr[0].id ? arr[0].id : null;
  } catch (e) { return null; }
}

async function zapCriarTask(videoId, ops) {
  ops = ops || {};
  // template: escolhido pelo usuário > ENV > 1º da conta (garante que existe)
  let templateId = ops.zapcap_template || process.env.ZAPCAP_TEMPLATE_ID || null;
  if (!templateId) templateId = await zapPrimeiroTemplate();
  if (!templateId) templateId = ZAPCAP_TEMPLATE_PADRAO; // último recurso
  const body = {
    templateId,
    autoApprove: true,
    language: 'pt',
    renderOptions: {
      subsOptions: { emoji: false, emphasizeKeywords: true, animation: true },
      styleOptions: {},
    },
  };
  // cor da legenda
  if (ops.legenda_cor) body.renderOptions.styleOptions.fontColor = ops.legenda_cor;
  // peso da fonte escolhida no modal (mapa de fontes básicas) + caixa alta (padrão de legenda)
  if (ops.legenda_peso) body.renderOptions.styleOptions.fontWeight = Number(ops.legenda_peso);
  body.renderOptions.styleOptions.fontUppercase = true;
  // posição: top = Y em % (70=embaixo p/ Reels, 45=mais central p/ VSL)
  body.renderOptions.styleOptions.top = ops.vsl ? 45 : 70;
  // VSL: fonte MENOR (mais discreta, estilo vídeo de vendas — não briga com o rosto/fala)
  if (ops.vsl) body.renderOptions.styleOptions.fontSize = 26;
  // contorno preto (legibilidade) se o usuário escolheu SEM fundo
  if (ops.legenda_fundo === false) { body.renderOptions.styleOptions.stroke = 's'; body.renderOptions.styleOptions.strokeColor = '#000000'; }
  // CORTAR SILÊNCIO (a dor resolvida) — autoCutSettings.silenceRemoval 0-1 (0.3 = bom padrão)
  if (ops.cortar_silencio) {
    body.autoCutSettings = { silenceRemoval: ops.silencio_intensidade != null ? Number(ops.silencio_intensidade) : 0.3 };
  }

  const r = await fetch(`${ZAPCAP_BASE}/videos/${videoId}/task`, {
    method: 'POST', headers: zapHeaders(), body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) return { error: (d && (d.detail || (d.errors && d.errors[0] && d.errors[0].detail) || JSON.stringify(d))) || 'erro na task ZapCap' };
  const taskId = d && (d.taskId || d.id);
  if (!taskId) return { error: 'ZapCap sem taskId: ' + JSON.stringify(d).slice(0, 150) };
  return { taskId };
}

// 3. Consulta a task. Retorna { done, url } | { failed, motivo } | { processing }.
async function zapCheckTask(videoId, taskId) {
  const r = await fetch(`${ZAPCAP_BASE}/videos/${videoId}/task/${taskId}`, { headers: zapHeaders() });
  const d = await r.json();
  const st = d && d.status;
  if (st === 'completed' && d.downloadUrl) return { done: true, url: d.downloadUrl };
  if (st === 'failed' || st === 'error') return { failed: true, motivo: (d && (d.error || d.detail)) || 'ZapCap falhou' };
  return { processing: true, status: st || '?' };
}

// Mapeia a posição da legenda. Para VSL, "centro" sobe a legenda (margin.top menor faz descer; usamos margin.bottom).
// offset.y: 0 = centro, negativo = mais pra baixo. Usamos margin que é o recomendado p/ caption.

// Biblioteca de trilhas royalty-free por estilo (FreePD - CC0, livres de direitos).
// O agente escolhe uma variação aleatória pra não repetir entre vídeos.
// URLs REAIS confirmadas na doc/templates do Shotstack (shotstack-assets S3).
const A = 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/';
const TRILHAS = {
  animada: [ A+'unminus/lit.mp3', A+'disco.mp3' ],
  calma: [ A+'unminus/palmtrees.mp3', A+'freepd/motions.mp3' ],
  reflexiva: [ A+'unminus/berlin.mp3', A+'freepd/motions.mp3' ],
  corporativa: [ A+'unminus/palmtrees.mp3', A+'unminus/berlin.mp3' ],
  inspiradora: [ A+'unminus/lit.mp3', A+'unminus/palmtrees.mp3' ],
};
function escolherTrilha(estilo) {
  const lista = TRILHAS[estilo] || TRILHAS.animada;
  return lista[Math.floor(Math.random() * lista.length)];
}

function montarEdit(origemUrl, ops, srtUrl) {
  const isReels = ops.formato !== 'wide';
  const largura = isReels ? 1080 : 1920;
  const altura = isReels ? 1920 : 1080;

  // clip principal do vídeo
  const videoClip = {
    asset: {
      type: 'video',
      src: origemUrl,
      volume: ops.mutar ? 0 : 1,
    },
    start: 0,
    // sem corte = 'auto' (vídeo inteiro). A legenda (caption) segue o SRT com os
    // timestamps reais, então cobre toda a fala do vídeo do início ao fim.
    length: (ops.corte_fim && ops.corte_inicio != null) ? (Number(ops.corte_fim) - Number(ops.corte_inicio)) : 'auto',
  };
  if (ops.corte_inicio != null) videoClip.asset.trim = Number(ops.corte_inicio);

  if (ops.filtro) videoClip.filter = ops.filtro; // greyscale, boost, contrast, darken, lighten, muted, negative
  if (ops.estilo_corte) videoClip.transition = { in: ops.estilo_corte, out: ops.estilo_corte };

  const tracks = [{ clips: [videoClip] }];

  // logo (overlay) no canto — posição configurável (padrão: canto superior direito)
  if (ops.logo_url) {
    const pos = { 'top-right': { x: 0.38, y: 0.42 }, 'top-left': { x: -0.38, y: 0.42 }, 'bottom-right': { x: 0.38, y: -0.42 }, 'bottom-left': { x: -0.38, y: -0.42 } };
    const off = pos[ops.logo_posicao] || pos['top-right'];
    tracks.unshift({ clips: [{
      asset: { type: 'image', src: ops.logo_url },
      start: 0, length: 'end',
      offset: off, scale: 0.14, opacity: 0.95,
    }] });
  }

  const timeline = { background: '#000000', tracks };

  // trilha sonora: por estilo (agente escolhe variação) ou URL direta (legado)
  let trilhaSrc = ops.trilha_url;
  if (!trilhaSrc && ops.trilha_estilo) trilhaSrc = escolherTrilha(ops.trilha_estilo);
  if (trilhaSrc) {
    timeline.soundtrack = { src: trilhaSrc, effect: 'fadeInFadeOut', volume: ops.trilha_volume != null ? Number(ops.trilha_volume) : 0.25 };
  }

  // NOTA: a LEGENDA é feita pelo ZapCap (fase 2), não pelo Shotstack.
  // Aqui o Shotstack só faz a COMPOSIÇÃO visual (trilha, filtro, logo).

  return {
    timeline,
    output: { format: 'mp4', size: { width: largura, height: altura }, fps: 30 },
  };
}

// ETAPA 1 — dispara a transcrição (Ingest API). Retorna { source_id } ou { error }.
async function iniciarTranscricao(origemUrl, ops) {
  ops = ops || {};
  const outputs = { transcription: { format: 'srt' } };
  // tratamento de voz: gera uma rendition com áudio melhorado (Dolby) que será usada no render
  if (ops.melhorar_voz) {
    outputs.renditions = [{
      format: 'mp4',
      enhance: { audio: { provider: 'dolby', options: { preset: 'studio' } } },
      filename: 'voz-melhorada',
    }];
  }
  const r = await fetch(`${SHOTSTACK_BASE}/ingest/${shotEnv()}/sources`, {
    method: 'POST', headers: shotHeaders(),
    body: JSON.stringify({ url: origemUrl, outputs }),
  });
  const d = await r.json();
  if (!r.ok) return { error: (d && (d.message || JSON.stringify(d))) || 'erro no ingest' };
  const sourceId = d && d.data && d.data.id;
  if (!sourceId) return { error: 'ingest sem id: ' + JSON.stringify(d).slice(0, 150) };
  return { source_id: sourceId };
}

// ETAPA 2 — consulta a transcrição. Retorna { ready, srt_url } | { failed } | { waiting }.
async function checarTranscricao(sourceId) {
  const r = await fetch(`${SHOTSTACK_BASE}/ingest/${shotEnv()}/sources/${sourceId}`, { headers: shotHeaders() });
  const d = await r.json();
  const attr = d && d.data && d.data.attributes;
  if (!attr) return { waiting: true, debug: JSON.stringify(d).slice(0, 200) };
  // o source precisa estar 'ready' primeiro; depois a transcrição aparece em outputs.transcription
  const tr = attr.outputs && attr.outputs.transcription;
  if (tr && tr.status === 'ready' && tr.url) return { ready: true, srt_url: tr.url };
  if (tr && tr.status === 'failed') return { failed: true, motivo: 'transcrição falhou' };
  if (attr.status === 'failed') return { failed: true, motivo: 'ingest do vídeo falhou (formato/URL?)' };
  // ainda processando (source importando ou transcrição em andamento)
  return { waiting: true, debug: 'source:' + (attr.status||'?') + ' trans:' + ((tr&&tr.status)||'pendente') };
}

// ETAPA 3 — dispara o render. Retorna { render_id } ou { error }.
async function iniciarRender(edit) {
  const siteUrl = process.env.SITE_URL || 'https://metodojump.com.br';
  edit.callback = `${siteUrl}/api/video-webhook`;
  const r = await fetch(`${SHOTSTACK_BASE}/edit/${shotEnv()}/render`, {
    method: 'POST', headers: shotHeaders(), body: JSON.stringify(edit),
  });
  const d = await r.json();
  if (!r.ok || !d.success) {
    const detalhe = (d && (d.message || (d.response && d.response.error))) || JSON.stringify(d).slice(0, 250);
    return { error: detalhe };
  }
  return { render_id: d.response && d.response.id };
}

// Consulta o status de um render. Retorna { done, url } | { failed } | { rendering }.
async function checarRender(renderId) {
  const r = await fetch(`${SHOTSTACK_BASE}/edit/${shotEnv()}/render/${renderId}`, { headers: shotHeaders() });
  const d = await r.json();
  const st = d && d.response && d.response.status;
  const url = d && d.response && d.response.url;
  const err = d && d.response && (d.response.error || d.response.data && d.response.data.message);
  if (st === 'done' && url) return { done: true, url };
  if (st === 'failed') return { failed: true, motivo: err || 'sem detalhe do Shotstack' };
  return { rendering: true };
}


// Copia o vídeo final do Shotstack para o nosso Supabase Storage (resolve as 24h).
// Retorna { url, path } ou { error }. Usa stream-ish (arrayBuffer) — ok p/ Reels (curtos).
async function salvarVideoNoBanco(shotstackUrl, userId, supabaseUrl, serviceKey) {
  try {
    const resp = await fetch(shotstackUrl);
    if (!resp.ok) return { error: 'download falhou: ' + resp.status };
    const buf = Buffer.from(await resp.arrayBuffer());
    // limite de segurança: 45MB (Reels costuma ser bem menor; evita timeout/memória)
    if (buf.length > 45 * 1024 * 1024) return { error: 'vídeo grande demais p/ copiar (>45MB)', tooBig: true };
    const path = `${userId}/pronto_${Date.now()}.mp4`;
    const up = await fetch(`${supabaseUrl}/storage/v1/object/videos-prontos/${path}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
      body: buf,
    });
    if (!up.ok) { const t = await up.text(); return { error: 'upload Supabase falhou: ' + t.slice(0, 120) }; }
    const url = `${supabaseUrl}/storage/v1/object/public/videos-prontos/${path}`;
    return { url, path };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { montarEdit, iniciarTranscricao, checarTranscricao, iniciarRender, checarRender, shotEnv, shotHeaders, salvarVideoNoBanco, zapUpload, zapCriarTask, zapCheckTask };
