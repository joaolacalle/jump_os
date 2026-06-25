// api/video-webhook.js — recebe o aviso do Shotstack quando o render termina
// O Shotstack chama esta URL (definida em edit.callback) com o status do render.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function H() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
}
async function sbPatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) });
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
