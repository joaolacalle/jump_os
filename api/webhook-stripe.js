// api/webhook-stripe.js — Vercel Serverless Function
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL   = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY; // service_role key (não a anon)

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const sig  = req.headers['stripe-signature'];
  const body = req.body;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    switch (event.type) {

      // ── PAGAMENTO CONFIRMADO ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email   = session.customer_email || session.metadata?.email;
        const plano   = session.metadata?.plano || 'plus';
        const nome    = session.metadata?.nome  || '';

        console.log(`✅ Checkout completo: ${email} — plano ${plano}`);

        // Atualizar cliente no Supabase
        if (email) {
          const { error } = await supa
            .from('clientes')
            .update({
              plano,
              status: 'ativo',
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              ativado_em: new Date().toISOString(),
            })
            .eq('email', email);

          if (error) console.error('Supabase update error:', error);
        }

        // Enviar email de boas-vindas via Resend
        await sendWelcomeEmail(email, nome, plano);
        break;
      }

      // ── ASSINATURA CRIADA ──
      case 'customer.subscription.created': {
        const sub   = event.data.object;
        const cusId = sub.customer;
        console.log(`📋 Assinatura criada: ${cusId}`);

        await supa
          .from('clientes')
          .update({ status: 'ativo', stripe_subscription_id: sub.id })
          .eq('stripe_customer_id', cusId);
        break;
      }

      // ── ASSINATURA CANCELADA ──
      case 'customer.subscription.deleted': {
        const sub   = event.data.object;
        const cusId = sub.customer;
        console.log(`❌ Assinatura cancelada: ${cusId}`);

        await supa
          .from('clientes')
          .update({ status: 'cancelado' })
          .eq('stripe_customer_id', cusId);
        break;
      }

      // ── PAGAMENTO FALHOU ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const cusId   = invoice.customer;
        console.log(`⚠ Pagamento falhou: ${cusId}`);

        await supa
          .from('clientes')
          .update({ status: 'inadimplente' })
          .eq('stripe_customer_id', cusId);
        break;
      }

      default:
        console.log(`Evento ignorado: ${event.type}`);
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── ENVIAR EMAIL DE BOAS-VINDAS ──
async function sendWelcomeEmail(email, nome, plano) {
  if (!email) return;

  const planNames  = { basico: 'Básico', plus: 'Plus', pro: 'Pro' };
  const planPrices = { basico: 'R$99/mês', plus: 'R$199/mês', pro: 'R$399/mês' };

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'JUMP OS <contato@metodojump.com.br>',
        to: [email],
        subject: `Bem-vindo ao JUMP OS — Plano ${planNames[plano] || plano} ativado!`,
        html: `
<div style="background:#060607;padding:40px 20px;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <div style="background:#0F0F12;border:1px solid #1E1E26;border-radius:16px;overflow:hidden">
      <div style="height:3px;background:#00E676"></div>
      <div style="padding:36px">
        <div style="font-family:monospace;font-size:14px;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:#fff;margin-bottom:24px">
          JUMP <span style="color:#00E676">OS</span>
        </div>
        <h1 style="font-size:22px;font-weight:900;color:#fff;text-transform:uppercase;margin:0 0 10px">
          Plano ${planNames[plano] || plano} ativado!
        </h1>
        <p style="color:#9090A0;font-size:14px;line-height:1.7;margin:0 0 24px">
          ${nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!'} Seu pagamento foi confirmado e os agentes já estão em operação.
        </p>
        <div style="background:#14141A;border:1px solid #2A2A35;border-radius:10px;padding:16px;margin-bottom:24px">
          <div style="font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#50505C;margin-bottom:10px">Seu plano</div>
          <div style="font-size:18px;font-weight:900;color:#00E676">${planNames[plano] || plano}</div>
          <div style="font-size:13px;color:#9090A0;margin-top:4px">${planPrices[plano] || ''} · 7 dias grátis incluídos</div>
        </div>
        <div style="background:#14141A;border:1px solid #2A2A35;border-radius:10px;padding:16px;margin-bottom:24px">
          <div style="font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#50505C;margin-bottom:12px">Próximos passos</div>
          <div style="color:#9090A0;font-size:13px;line-height:1.9">
            <span style="color:#00E676;font-weight:900">1.</span> Acesse sua dashboard<br>
            <span style="color:#00E676;font-weight:900">2.</span> Conecte seu Instagram<br>
            <span style="color:#00E676;font-weight:900">3.</span> Converse com o Agente de Identidade<br>
            <span style="color:#00E676;font-weight:900">4.</span> Os agentes entram em ação em até 24h
          </div>
        </div>
        <div style="text-align:center;margin-bottom:20px">
          <a href="https://jump-os-one.vercel.app/dashboard-usuario.html"
             style="display:inline-block;background:#00E676;color:#000;text-decoration:none;padding:14px 36px;border-radius:9px;font-size:13px;font-weight:800;letter-spacing:.5px;text-transform:uppercase">
            → Acessar minha dashboard
          </a>
        </div>
        <p style="font-size:11px;color:#50505C;line-height:1.6;margin:0">
          Dúvidas: <a href="mailto:contato@metodojump.com.br" style="color:#9090A0">contato@metodojump.com.br</a>
        </p>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#50505C;margin-top:20px">
      © 2026 JUMP OS · João Vittor · <a href="https://metodojump.com.br" style="color:#50505C">metodojump.com.br</a>
    </p>
  </div>
</div>`
      })
    });
    console.log(`📧 Email de boas-vindas enviado para ${email}`);
  } catch (err) {
    console.error('Erro ao enviar email:', err);
  }
}
