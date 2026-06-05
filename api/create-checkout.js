// api/create-checkout.js — Vercel Serverless Function
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  basico: 'price_1TdyWmFirrEZk0ddzLJq3Lcu',
  plus:   'price_1TdyYvFirrEZk0dd4vlrwFoj',
};

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plano, email, nome } = req.body;

    if (!plano || !PRICE_IDS[plano]) {
      return res.status(400).json({ error: 'Plano inválido' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email || undefined,
      locale: 'pt-BR',
      line_items: [{
        price: PRICE_IDS[plano],
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { plano, nome: nome || '' }
      },
      success_url: `https://jump-os-one.vercel.app/dashboard-usuario.html?payment=success`,
      cancel_url:  `https://jump-os-one.vercel.app/checkout.html?plano=${plano}&cancelled=true`,
      metadata: { plano, nome: nome || '', email: email || '' }
    });

    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
