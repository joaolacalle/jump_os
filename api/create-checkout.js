// api/create-checkout.js — Vercel Serverless Function (PayPal Subscriptions)
// Compatível com checkout.html (payload: {plano, email, userId} → retorna {url})
// ENV necessárias na Vercel: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE (sandbox|live)

const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Plan IDs do PayPal — criar no painel (instruções na entrega) e colar aqui
const PLANS = {
  basico: process.env.PAYPAL_PLAN_BASICO, // ex: P-1AB23456CD789012EABCDEFG
  plus:   process.env.PAYPAL_PLAN_PLUS,
};

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Falha na autenticação PayPal');
  const data = await res.json();
  return data.access_token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { plano, email, userId } = req.body || {};

    if (!plano || !PLANS[plano]) {
      return res.status(400).json({ error: 'Plano inválido' });
    }
    if (!email) {
      return res.status(400).json({ error: 'E-mail obrigatório' });
    }
    if (!PLANS[plano]) {
      return res.status(500).json({ error: 'Plan ID não configurado' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const token = await getAccessToken();

    const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: PLANS[plano],
        subscriber: { email_address: email },
        custom_id: JSON.stringify({ userId: userId || '', plano }),
        application_context: {
          brand_name: 'JUMP OS',
          locale: 'pt-BR',
          user_action: 'SUBSCRIBE_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${origin}/dashboard-usuario.html?pagamento=sucesso`,
          cancel_url: `${origin}/checkout.html?plano=${plano}`,
        },
      }),
    });

    const sub = await subRes.json();
    if (!subRes.ok) {
      console.error('PayPal error:', JSON.stringify(sub));
      return res.status(500).json({ error: 'Erro ao criar assinatura' });
    }

    const approve = (sub.links || []).find(l => l.rel === 'approve');
    if (!approve) {
      return res.status(500).json({ error: 'Link de aprovação não retornado' });
    }

    return res.status(200).json({ url: approve.href, subscriptionId: sub.id });
  } catch (err) {
    console.error('create-checkout error:', err.message);
    return res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
  }
};
