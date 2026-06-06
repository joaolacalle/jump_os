// api/webhook-stripe.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// CRÍTICO: desabilitar body parser do Vercel para receber raw body
export const config = { api: { bodyParser: false } };

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL   = 'https://fcdjzubdxikpvcqvalnt.supabase.co';

// Ler body como buffer (necessário para verificar assinatura Stripe)
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supa = createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log(`📩 Evento recebido: ${event.type}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const email   = session.customer_email || session.metadata?.email;
        const plano   = session.metadata?.plano || 'plus';
        const nome    = session.metadata?.nome  || '';

        console.log(`✅ Checkout completo: ${email} — plano ${plano}`);

        if (email) {
          await supa.from('clientes').update({
            plano,
            status: 'ativo',
            email,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            ativado_em: new Date().toISOString(),
          }).eq('email', email);
        }

        await sendWelcomeEmail(email, nome, plano);
        break;
      }

      case 'customer.subscription.deleted': {
        const cusId = event.data.object.customer;
        console.log(`❌ Assinatura cancelada: ${cusId}`);
        await supa.from('clientes').update({ status: 'cancelado' })
          .eq('stripe_customer_id', cusId);
        break;
      }

      case 'invoice.payment_failed': {
        const cusId = event.data.object.customer;
        console.log(`⚠ Pagamento falhou: ${cusId}`);
        await supa.from('clientes').update({ status: 'inadimplente' })
          .eq('stripe_customer_id', cusId);
        break;
      }

      default:
        console.log(`Evento ignorado: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function sendWelcomeEmail(email, nome, plano) {
  if (!email || !process.env.RESEND_API_KEY) return;

  const nomes   = { basico: 'Básico', plus: 'Plus', pro: 'Pro' };
  const precos  = { basico: 'R$99/mês', plus: 'R$199/mês', pro: 'R$399/mês' };
  const primeiroNome = nome ? nome.split(' ')[0] : '';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'JUMP OS <contato@metodojump.com.br>',
        to: [email],
        subject: `Plano ${nomes[plano] || plano} ativado — JUMP OS`,
        html: `
<div style="background:#060607;padding:40px 20px;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">
<div style="background:#0F0F12;border:1px solid #1E1E26;border-radius:16px;overflow:hidden">
<div style="height:3px;background:#00E676"></div>
<div style="padding:36px">
<div style="font-family:monospace;font-size:14px;font-weight:700;letter-spacing:6px;color:#fff;margin-bottom:24px">JUMP <span style="color:#00E676">OS</span></div>
<h1 style="font-size:22px;font-weight:900;color:#fff;text-transform:uppercase;margin:0 0 10px">
${primeiroNome ? `Bem-vindo, ${primeiroNome}!` : 'Conta ativada!'}
</h1>
<p style="color:#9090A0;font-size:14px;line-height:1.7;margin:0 0 24px">
Seu pagamento foi confirmado e o plano <strong style="color:#fff">${nomes[plano] || plano}</strong> (${precos[plano] || ''}) está ativo. Os agentes já estão em operação.
</p>
<div style="background:#14141A;border:1px solid #2A2A35;border-radius:10px;padding:16px;margin-bottom:24px">
<div style="font-size:9px;font-weight:800;letter-spacing:3px;color:#50505C;margin-bottom:12px;text-transform:uppercase">Próximos passos</div>
<div style="color:#9090A0;font-size:13px;line-height:1.9">
<span style="color:#00E676;font-weight:900">1.</span> Acesse sua dashboard<br>
<span style="color:#00E676;font-weight:900">2.</span> Conecte seu Instagram<br>
<span style="color:#00E676;font-weight:900">3.</span> Converse com o Agente de Identidade<br>
<span style="color:#00E676;font-weight:900">4.</span> Os agentes entram em ação
</div>
</div>
<div style="text-align:center;margin-bottom:20px">
<a href="https://jump-os-one.vercel.app/dashboard-usuario.html"
style="display:inline-block;background:#00E676;color:#000;text-decoration:none;padding:14px 36px;border-radius:9px;font-size:13px;font-weight:800;letter-spacing:.5px;text-transform:uppercase">
→ Acessar minha dashboard
</a>
</div>
<p style="font-size:11px;color:#50505C;margin:0">
Dúvidas: <a href="mailto:contato@metodojump.com.br" style="color:#9090A0">contato@metodojump.com.br</a>
</p>
</div></div>
<p style="text-align:center;font-size:11px;color:#50505C;margin-top:20px">© 2026 JUMP OS · João Vittor</p>
</div></div>`
      })
    });
    console.log(`📧 Email enviado: ${r.status}`);
  } catch (err) {
    console.error('Erro email:', err.message);
  }
}
