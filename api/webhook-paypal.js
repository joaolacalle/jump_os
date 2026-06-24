// api/webhook-paypal.js — ativa a conta no Supabase quando a assinatura é ativada
// ENV: SUPABASE_SERVICE_KEY (já existe na Vercel), SUPABASE_URL opcional
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';

// Limites por plano (espelham os defaults do admin-users.js / config 'planos')
const LIMS_DEFAULT = {
  basico: { imagens: 12, reloads: 6,  videos: 0,  tokens: 200000 },
  plus:   { imagens: 18, reloads: 9,  videos: 2,  tokens: 500000 },
  pro:    { imagens: 25, reloads: 15, videos: 15, tokens: 1200000 },
};

const H = () => ({
  'apikey': process.env.SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

// Busca os limites do plano: tenta a config 'planos' do banco; senão usa os defaults
async function limitesDoPlano(plano) {
  let lims = LIMS_DEFAULT;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/config?chave=eq.planos&select=valor&limit=1`, { headers: H() });
    const j = await r.json();
    if (Array.isArray(j) && j[0] && j[0].valor) lims = { ...LIMS_DEFAULT, ...j[0].valor };
  } catch (e) {}
  return lims[plano] || LIMS_DEFAULT[plano] || null;
}

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
        // Monta o patch: ativa + define plano + aplica os limites do plano
        const patch = {
          status: 'ativo',
          assinatura_id: resource.id || resource.billing_agreement_id || '',
        };
        if (plano) {
          patch.plano = plano;
          const lims = await limitesDoPlano(plano);
          if (lims) {
            // preserva limites existentes e sobrescreve os do plano
            let atual = {};
            try {
              const filter = userId ? `id=eq.${userId}` : `email=eq.${encodeURIComponent(email)}`;
              const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes?${filter}&select=limites`, { headers: H() });
              const j = await r.json();
              if (Array.isArray(j) && j[0] && j[0].limites) atual = j[0].limites;
            } catch (e) {}
            patch.limites = { ...atual, ...lims };
          }
        }
        // COTA DE TRIAL: ao ATIVAR (início da assinatura), marca o fim do período
        // de teste (cortesia_ate = hoje + dias do trial). Durante esse período, o
        // gerar-imagem aplica a cota reduzida. Só marca em ACTIVATED e se ainda não existir.
        if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
          try {
            const filter0 = userId ? `id=eq.${userId}` : `email=eq.${encodeURIComponent(email)}`;
            const r0 = await fetch(`${SUPABASE_URL}/rest/v1/clientes?${filter0}&select=cortesia_ate`, { headers: H() });
            const j0 = await r0.json();
            const jaTem = Array.isArray(j0) && j0[0] && j0[0].cortesia_ate;
            if (!jaTem) {
              let dias = 7;
              try {
                const tr = await fetch(`${SUPABASE_URL}/rest/v1/config?chave=eq.trial&select=valor&limit=1`, { headers: H() });
                const tj = await tr.json();
                if (Array.isArray(tj) && tj[0] && tj[0].valor && tj[0].valor.dias) dias = Number(tj[0].valor.dias);
              } catch (e) {}
              patch.cortesia_ate = new Date(Date.now() + dias * 24 * 3600 * 1000).toISOString();
              patch.tipo_cortesia = 'trial';  // assinatura nova entra em período de teste real
            }
          } catch (e) {}
        }
        const filter = userId ? `id=eq.${userId}` : `email=eq.${encodeURIComponent(email)}`;
        await fetch(`${SUPABASE_URL}/rest/v1/clientes?${filter}`, {
          method: 'PATCH',
          headers: { ...H(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(patch),
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
          headers: { ...H(), 'Prefer': 'return=minimal' },
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
