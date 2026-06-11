// api/webhook-paypal.js — ativa a conta no Supabase quando a assinatura é ativada
// ENV: SUPABASE_SERVICE_KEY (já existe na Vercel), SUPABASE_URL opcional
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const event = req.body;
    const type = event && event.event_type;

    // Eventos relevantes de assinatura
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED' || type === 'PAYMENT.SALE.COMPLETED') {
      const resource = event.resource || {};
      let userId = '', plano = '';
      try {
        const custom = JSON.parse(resource.custom_id || resource.custom || '{}');
        userId = custom.userId || '';
        plano = custom.plano || '';
      } catch (e) { /* custom_id pode não ser JSON */ }

      const email = resource.subscriber && resource.subscriber.email_address;

      if (userId || email) {
        // Atualiza status do cliente no Supabase via REST (service role)
        const filter = userId ? `id=eq.${userId}` : `email=eq.${encodeURIComponent(email)}`;
        await fetch(`${SUPABASE_URL}/rest/v1/clientes?${filter}`, {
          method: 'PATCH',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            status: 'ativo',
            plano: plano || undefined,
            assinatura_id: resource.id || resource.billing_agreement_id || '',
          }),
        });
      }
    }

    if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      const resource = event.resource || {};
      let userId = '';
      try { userId = JSON.parse(resource.custom_id || '{}').userId || ''; } catch (e) {}
      if (userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ status: 'cancelado' }),
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('webhook-paypal error:', err.message);
    return res.status(200).json({ received: true }); // 200 evita re-tentativas infinitas
  }
};
