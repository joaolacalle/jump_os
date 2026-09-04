// api/video-webhook.js — recebe o aviso do Shotstack quando o render termina
// O Shotstack chama esta URL (definida em edit.callback) com o status do render.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function H() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
}
// REPARO AVULSO — VISIBILIDADE DE FALHA NA GRAVAÇÃO (04/set/2026, mesmo achado de
// api/agente-chat.js — ver APRENDIZADOS.md "regressão — conversa parou de ser gravada"): antes,
// uma recusa do Supabase (400 etc.) passava batido, sem log nenhum. Resposta ao Shotstack
// continua sempre 200 (comentário original abaixo, não mudou) — só passa a logar quando o PATCH
// falhar de verdade, e a devolver a Response pra quem quiser conferir.
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) });
  if (!r.ok) {
    let motivo = ''; try { const j = await r.json(); motivo = j.message || j.hint || j.details || JSON.stringify(j).slice(0, 200); } catch (e) {}
    console.error('[video-webhook] sbPatch falhou — path=' + path + ' status=' + r.status + ' motivo=' + String(motivo).slice(0, 200));
  }
  return r;
}

module.exports = async (req, res) => {
  // O Shotstack envia POST com { type, action, id, render, url, status, ... }
  try {
    const body = req.body || {};
    const renderId = body.id || (body.response && body.response.id);
    const status = body.status || (body.response && body.response.status);
    const url = body.url || (body.response && body.response.url);

    if (!renderId) return res.status(200).json({ ok: true }); // ignora chamadas sem id

    if (status === 'done' && url) {
      await sbPatch(`video_jobs?render_id=eq.${renderId}`, {
        status: 'pronto', resultado_url: url, updated_at: new Date().toISOString(),
      });
    } else if (status === 'failed') {
      await sbPatch(`video_jobs?render_id=eq.${renderId}`, {
        status: 'erro', erro: 'O render falhou no Shotstack.', updated_at: new Date().toISOString(),
      });
    }
    // outros status (queued, rendering) não exigem ação

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('video-webhook error:', e.message);
    return res.status(200).json({ ok: true }); // sempre 200 p/ o Shotstack não reenviar
  }
};
