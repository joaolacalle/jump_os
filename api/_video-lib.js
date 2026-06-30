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
    length: (ops.corte_fim && ops.corte_inicio != null) ? (Number(ops.corte_fim) - Number(ops.corte_inicio)) : 'auto',
  };
  if (ops.corte_inicio != null) videoClip.asset.trim = Number(ops.corte_inicio);
  if (ops.velocidade && Number(ops.velocidade) !== 1) videoClip.asset.speed = Number(ops.velocidade);
  if (ops.filtro) videoClip.filter = ops.filtro; // greyscale, boost, contrast, darken, lighten, muted, negative
  if (ops.estilo_corte) videoClip.transition = { in: ops.estilo_corte, out: ops.estilo_corte };

  const tracks = [{ clips: [videoClip] }];

  // logo (overlay) — fica acima do vídeo
  if (ops.logo_url) {
    tracks.unshift({ clips: [{
      asset: { type: 'image', src: ops.logo_url },
      start: 0, length: 'end',
      offset: { x: 0.35, y: 0.40 }, scale: 0.15, opacity: 0.92,
    }] });
  }

  // texto/hook no início
  if (ops.texto) {
    tracks.unshift({ clips: [{
      asset: {
        type: 'title', text: String(ops.texto).slice(0, 80),
        style: 'minimal', size: 'medium', position: 'top',
      },
      start: 0, length: ops.texto_duracao ? Number(ops.texto_duracao) : 4,
      transition: { in: 'fade', out: 'fade' },
    }] });
  }

  const timeline = { background: '#000000', tracks };

  // trilha sonora: por estilo (agente escolhe variação) ou URL direta (legado)
  let trilhaSrc = ops.trilha_url;
  if (!trilhaSrc && ops.trilha_estilo) trilhaSrc = escolherTrilha(ops.trilha_estilo);
  if (trilhaSrc) {
    timeline.soundtrack = { src: trilhaSrc, effect: 'fadeInFadeOut', volume: ops.trilha_volume != null ? Number(ops.trilha_volume) : 0.25 };
  }

  // LEGENDA: usa o arquivo .srt gerado pela transcrição (srtUrl)
  // posição: VSL = mais ao centro (margin.bottom maior sobe a legenda)
  if (ops.legenda && srtUrl) {
    const ehVsl = !!ops.vsl;
    // Formato do caption conforme a doc oficial (mínimo que funciona + estilo seguro).
    // Posição via 'position' + 'offset' no CLIP (não 'margin' no asset, que quebrava).
    const caption = {
      asset: {
        type: 'caption',
        src: srtUrl,
        font: {
          family: ops.legenda_fonte || 'Montserrat ExtraBold',
          color: ops.legenda_cor || '#ffffff',
          size: isReels ? 42 : 34,
          lineHeight: 1,
        },
        background: { color: '#000000', opacity: 0.6 },
      },
      start: 0,
      length: 'end',
      // VSL = legenda ao centro; Reels = mais embaixo. offset.y negativo desce, positivo sobe.
      position: 'center',
      offset: { y: ehVsl ? -0.15 : -0.32 },
    };
    timeline.tracks.unshift({ clips: [caption] });
  }

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

module.exports = { montarEdit, iniciarTranscricao, checarTranscricao, iniciarRender, checarRender, shotEnv, shotHeaders, salvarVideoNoBanco };
