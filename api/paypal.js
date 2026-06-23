// api/paypal.js — PayPal consolidado (config + prices + checkout em 1 função)
// Resolve o limite de funções da Vercel. Decide a ação por ?action=
//   ?action=config   → Client ID + Plan IDs (público)
//   ?action=prices   → preços reais dos planos (cache 1h)
//   POST ?action=checkout {plano,email,userId} → cria assinatura, retorna {url}
// ENV: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE, PAYPAL_PLAN_BASICO/PLUS/PRO
const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const PLAN_IDS = {
  basico: process.env.PAYPAL_PLAN_BASICO,
  plus:   process.env.PAYPAL_PLAN_PLUS,
  pro:    process.env.PAYPAL_PLAN_PRO,
};

// Cache de preços em memória (1 hora)
let CACHE = { data: null, ts: 0 };
const CACHE_MS = 60 * 60 * 1000;

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Falha na autenticação PayPal');
  const data = await res.json();
  return data.access_token;
}

async function precoDoPlano(token, planId) {
  if (!planId) return null;
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans/${planId}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const plan = await res.json();
  const cycles = plan.billing_cycles || [];
  const pago = cycles.find(c => c.tenure_type === 'REGULAR') || cycles[0];
  const valor = pago && pago.pricing_scheme && pago.pricing_scheme.fixed_price
    ? pago.pricing_scheme.fixed_price.value : null;
  if (valor == null) return null;
  const num = Number(valor);
  const inteiro = Math.floor(num);
  const centavos = Math.round((num - inteiro) * 100);
  return {
    preco: `R$ ${inteiro.toLocaleString('pt-BR')}`,
    cents: ',' + String(centavos).padStart(2, '0'),
    valor: num,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query && req.query.action) || 'config';

  // ── CONFIG (público): clientId + plan ids ──
  if (action === 'config') {
    return res.status(200).json({
      clientId: process.env.PAYPAL_CLIENT_ID || '',
      plans: {
        basico: process.env.PAYPAL_PLAN_BASICO || '',
        plus: process.env.PAYPAL_PLAN_PLUS || '',
        pro: process.env.PAYPAL_PLAN_PRO || '',
      },
    });
  }

  // ── PRICES: preços reais do PayPal (cache 1h) ──
  if (action === 'prices') {
    if (CACHE.data && (Date.now() - CACHE.ts) < CACHE_MS) {
      return res.status(200).json({ precos: CACHE.data, cached: true });
    }
    try {
      const token = await getAccessToken();
      const precos = {};
      for (const [plano, id] of Object.entries(PLAN_IDS)) {
        const p = await precoDoPlano(token, id);
        if (p) precos[plano] = p;
      }
      CACHE = { data: precos, ts: Date.now() };
      return res.status(200).json({ precos, cached: false });
    } catch (err) {
      console.error('paypal prices:', err.message);
      if (CACHE.data) return res.status(200).json({ precos: CACHE.data, cached: true, stale: true });
      return res.status(200).json({ precos: {}, erro: true });
    }
  }

  // ── CHECKOUT (POST): cria a assinatura ──
  if (action === 'checkout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
    try {
      const { plano, email, userId } = req.body || {};
      if (!plano || !PLAN_IDS[plano]) return res.status(400).json({ error: 'Plano inválido' });
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const token = await getAccessToken();
      const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: PLAN_IDS[plano],
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
      if (!approve) return res.status(500).json({ error: 'Link de aprovação não retornado' });
      return res.status(200).json({ url: approve.href, subscriptionId: sub.id });
    } catch (err) {
      console.error('paypal checkout:', err.message);
      return res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
    }
  }

  return res.status(400).json({ error: 'Ação inválida' });
};
