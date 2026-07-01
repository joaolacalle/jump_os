// api/_email-lib.js — envio de emails transacionais via Resend
// Começa com _ → NÃO conta como função serverless na Vercel.
// ENV: RESEND_API_KEY, EMAIL_FROM (ex: "JUMP <nao-responda@metodojump.com.br>")

const SITE_URL = process.env.SITE_URL || 'https://metodojump.com.br';
const FROM = () => process.env.EMAIL_FROM || 'JUMP <onboarding@resend.dev>';

// Envia um email. Retorna { ok } | { error }. Nunca lança (não quebra o fluxo principal).
async function enviarEmail(para, assunto, html) {
  try {
    if (!process.env.RESEND_API_KEY) return { error: 'RESEND_API_KEY ausente' };
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [para], subject: assunto, html }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (d && (d.message || JSON.stringify(d))) || 'erro no Resend' };
    return { ok: true, id: d && d.id };
  } catch (e) {
    return { error: e.message };
  }
}

// ── LAYOUT base (visual roxo JUMP) ──
function layout(conteudoHtml) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0F0E0D;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0F0E0D;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1a1714;border:1px solid #2a2521;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#A855F7,#7c3aed);padding:32px 28px;text-align:center;">
<div style="font-size:30px;font-weight:800;color:#ffffff;letter-spacing:1px;">JUMP</div>
<div style="font-size:12px;color:#f0e6ff;margin-top:4px;letter-spacing:2px;text-transform:uppercase;">Marketing com Inteligência Artificial</div>
</td></tr>
<tr><td style="padding:34px 28px;">${conteudoHtml}</td></tr>
<tr><td style="padding:22px 28px;border-top:1px solid #2a2521;text-align:center;">
<div style="font-size:12px;color:#6b635b;line-height:1.6;">JUMP · Método JUMP<br>Este é um e-mail automático, não responda.</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function botao(url, texto) {
  return `<div style="text-align:center;margin:28px 0;"><a href="${url}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 40px;border-radius:10px;">${texto}</a></div>`;
}

// ── EMAIL 2: confirmação de compra ──
async function emailCompra(para, { plano, valor, data }) {
  const conteudo = `
    <div style="text-align:center;margin-bottom:8px;font-size:44px;">✅</div>
    <h1 style="font-size:22px;color:#ffffff;margin:0 0 16px;text-align:center;">Compra confirmada!</h1>
    <p style="font-size:15px;color:#c9c2ba;line-height:1.6;margin:0 0 20px;">Olá! Recebemos seu pagamento e sua assinatura já está <strong style="color:#4ade80;">ativa</strong>. Obrigado por confiar no JUMP.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#221d19;border:1px solid #3a332d;border-radius:12px;margin:22px 0;"><tr><td style="padding:20px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#c9c2ba;">
        <tr><td style="padding:6px 0;color:#8a827a;">Plano</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700;">${plano || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#8a827a;">Valor</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700;">${valor || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#8a827a;">Data</td><td style="padding:6px 0;text-align:right;color:#ffffff;">${data || new Date().toLocaleDateString('pt-BR')}</td></tr>
      </table>
    </td></tr></table>
    ${botao(SITE_URL + '/dashboard-usuario.html', 'Acessar meu painel')}
    <p style="font-size:13px;color:#8a827a;line-height:1.6;margin:20px 0 0;">Precisa de ajuda? Fale com a gente pelo Suporte JUMP dentro do sistema.</p>`;
  return enviarEmail(para, 'Compra confirmada — JUMP', layout(conteudo));
}

// ── EMAIL 3: conta criada pelo supervisor ──
async function emailContaCriada(para, { nomeSupervisor, email, senha }) {
  const conteudo = `
    <h1 style="font-size:22px;color:#ffffff;margin:0 0 16px;">Sua conta foi criada! 🎉</h1>
    <p style="font-size:15px;color:#c9c2ba;line-height:1.6;margin:0 0 20px;">Olá! Uma conta no JUMP foi criada para você${nomeSupervisor ? ' por <strong style="color:#A855F7;">' + nomeSupervisor + '</strong>' : ''}. Já pode acessar e começar a usar os agentes de IA para o seu Instagram.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#221d19;border:1px solid #3a332d;border-radius:12px;margin:22px 0;"><tr><td style="padding:20px 22px;">
      <div style="font-size:14px;font-weight:700;color:#FBBF24;margin-bottom:12px;">🔑 Seus dados de acesso</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#c9c2ba;">
        <tr><td style="padding:6px 0;color:#8a827a;">E-mail</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700;">${email}</td></tr>
        <tr><td style="padding:6px 0;color:#8a827a;">Senha provisória</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700;">${senha}</td></tr>
      </table>
      <div style="font-size:12px;color:#8a827a;margin-top:12px;line-height:1.5;">Por segurança, troque a senha no primeiro acesso em Configurações.</div>
    </td></tr></table>
    ${botao(SITE_URL + '/login.html', 'Acessar minha conta')}
    <p style="font-size:13px;color:#8a827a;line-height:1.6;margin:20px 0 0;">Ficou com dúvida de como começar? Use o Suporte JUMP dentro do sistema — ele te guia passo a passo.</p>`;
  return enviarEmail(para, 'Sua conta JUMP foi criada', layout(conteudo));
}

module.exports = { enviarEmail, emailCompra, emailContaCriada, layout };
