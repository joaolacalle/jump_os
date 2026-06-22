// api/paypal-prices.js — retorna os preços REAIS dos planos vindos do PayPal
// Assim, ao alterar o preço no PayPal, o site acompanha sem editar HTML.
// Cache em memória de 1 hora para não consultar o PayPal a cada visita.
// ENVs (mesmas do create-checkout): PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE,
//                                   PAYPAL_PLAN_BASICO, PAYPAL_PLAN_PLUS, PAYPAL_PLAN_PRO
const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const PLAN_IDS = {
  basico: process.env.PAYPAL_PLAN_BASICO,
  plus:   process.env.PAYPAL_PLAN_PLUS,
  pro:    process.env.PAYPAL_PLAN_PRO,
};

// Cache simples em memória (vive enquanto a função estiver "quente" na Vercel)
let CACHE = { data: null, ts: 0 };
const CACHE_MS = 60 * 60 * 1000; // 1 hora

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

// Busca o preço de um plano no PayPal e formata como { preco:'R$ 799', cents:',90' }
async function precoDoPlano(token, planId) {
  if (!planId) return null;
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans/${planId}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const plan = await res.json();
  // Pega o primeiro ciclo de cobrança com preço fixo (a mensalidade)
  const cycles = plan.billing_cycles || [];
  const pago = cycles.find(c => c.tenure_type === 'REGULAR') || cycles[0];
  const valor = pago && pago.pricing_scheme && pago.pricing_scheme.fixed_price
    ? pago.pricing_scheme.fixed_price.value : null;
  if (valor == null) return null;
  // Formata BRL: "799.90" → { preco:'R$ 799', cents:',90' }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Usa o cache se ainda válido (1h)
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
    console.error('paypal-prices error:', err.message);
    // Em caso de erro, devolve o último cache se houver (resiliência)
    if (CACHE.data) return res.status(200).json({ precos: CACHE.data, cached: true, stale: true });
    return res.status(200).json({ precos: {}, erro: true });
  }
};
