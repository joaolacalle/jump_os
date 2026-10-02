// api/meta-oauth.js — Instagram Graph API com Login da Empresa (Business Login)
// App tipo Empresa — fluxo OAuth 2.0 via Instagram Business Login
// ENV: META_APP_ID, META_APP_SECRET, SUPABASE_SERVICE_KEY, META_FB_APP_ID/META_FB_APP_SECRET (Ads)
// tipo=instagram → Instagram Business Login · tipo=ads → Login do Facebook (Marketing API, só leitura)
const SITE = 'https://www.metodojump.com.br';
const REDIRECT = `${SITE}/api/meta-callback`;
// Autenticar o início da conexão Meta (28/set/2026): antes, `uid` vinha cru da query — qualquer
// pessoa podia chamar /api/meta-oauth?tipo=instagram&uid=<id de outro cliente>, autorizar o
// próprio Instagram e o callback (que apaga a conexão anterior antes de inserir) sobrescrevia a
// legítima. O dono passa a vir do JWT — mesmo padrão de api/admin-users.js e api/video-editar.js
// (GET /auth/v1/user com o apikey de serviço). Conectar em nome de outra conta continua possível,
// mas vira decisão do SERVIDOR: só quem tem clientes.role admin/supervisor (mesma fonte de papel
// usada em todo o resto do backend — admin-users.js, agente-chat.js, gerar-imagem.js,
// video-editar.js) pode indicar um `alvo` diferente de si mesmo.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const SBH = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
});
const { GRAPH_V: ADS_GRAPH_V, fbAppId } = require('./_ads-lib.js');
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SBH() });
  return r.json();
}

// Quem está chamando (JWT) e a conta-alvo — mesma regra do GET: alvo diferente de si mesmo só
// para admin/supervisor. Devolve { uid } ou { erro:[status,msg] }.
async function resolverDono(req) {
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return { erro: [401, 'Não autenticado'] };
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` },
  });
  const requester = await uRes.json();
  if (!uRes.ok || !requester.id) return { erro: [401, 'Sessão inválida'] };
  const alvoBruto = (req.body && req.body.alvo) || (req.query && req.query.alvo);
  if (!alvoBruto || String(alvoBruto) === requester.id) return { uid: requester.id };
  if (!isUuid(alvoBruto)) return { erro: [400, 'Parâmetros inválidos'] };
  const [me] = await sbGet(`clientes?id=eq.${requester.id}&select=role`);
  const role = (me && me.role) || 'usuario';
  if (role !== 'admin' && role !== 'supervisor') return { erro: [403, 'Sem permissão para conectar em nome de outra conta'] };
  return { uid: String(alvoBruto) };
}

// POST { acao:'escolher_conta', ad_account_id, alvo? } — escolhe QUAL conta de anúncios o JUMP lê,
// entre as que vieram autorizadas no callback (meta.contas_ads). Nunca aceita um id fora dessa
// lista: o cliente não consegue apontar a leitura para uma conta que não autorizou.
async function tratarPost(req, res) {
  const { acao, ad_account_id } = req.body || {};
  if (acao !== 'escolher_conta' || !/^act_\d+$/.test(String(ad_account_id || ''))) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const d = await resolverDono(req);
  if (d.erro) return res.status(d.erro[0]).json({ error: d.erro[1] });
  const [cc] = await sbGet(`contas_conectadas?user_id=eq.${d.uid}&tipo=eq.ads&select=id,meta&limit=1`);
  if (!cc) return res.status(404).json({ error: 'Meta Ads não conectado' });
  const meta = cc.meta || {};
  const escolhida = (meta.contas_ads || []).find(c => c.id === ad_account_id);
  if (!escolhida) return res.status(400).json({ error: 'Conta não autorizada nesta conexão' });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?id=eq.${cc.id}`, {
    method: 'PATCH', headers: SBH(),
    body: JSON.stringify({
      nome: escolhida.nome,
      meta: { ...meta, ad_account_id: escolhida.id, ad_account_nome: escolhida.nome, moeda: escolhida.moeda, fuso: escolhida.fuso },
    }),
  });
  if (!r.ok) return res.status(500).json({ error: 'Não foi possível salvar a escolha' });
  return res.status(200).json({ ok: true, conta: escolhida.nome });
}

module.exports = async (req, res) => {
  // O endpoint agora recebe credencial (Authorization) — não pode mais ser chamável de
  // qualquer origem.
  res.setHeader('Access-Control-Allow-Origin', SITE);
  try {
    if (req.method === 'POST') return await tratarPost(req, res);
    const { tipo } = req.query || {};
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      return res.status(503).json({ error: 'Meta não configurada' });
    }
    if (!tipo || !['instagram','ads'].includes(tipo)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }

    // 1. Identificar quem está chamando, pelo JWT — o uid deixou de vir da query.
    // 2. `alvo` opcional (conectar em nome de outra conta) — aceito no corpo ou na query.
    // Sem alvo, ou com alvo igual a quem chamou, o dono é o próprio requester (caminho comum,
    // sem checagem extra). Com um alvo diferente, só prossegue se o papel de quem chamou
    // (clientes.role) for admin ou supervisor — senão 403. (Extraído para resolverDono, que o
    // POST de escolher_conta também usa.)
    const dono = await resolverDono(req);
    if (dono.erro) return res.status(dono.erro[0]).json({ error: dono.erro[1] });
    const uid = dono.uid;

    // ACEITE DE RESPONSABILIDADE (Meta Ads, 02/out/2026, decisão do João): ativar campanha e
    // definir orçamento são sempre do cliente. Sem o aceite marcado na tela, a conexão de Ads nem
    // começa. O momento do aceite viaja DENTRO do state assinado e é gravado pelo callback na
    // conexão — prova de que o cliente concordou antes de autorizar.
    let aceiteEm = '';
    if (tipo === 'ads') {
      const aceite = (req.query && req.query.aceite) || (req.body && req.body.aceite);
      if (String(aceite) !== '1') return res.status(400).json({ error: 'Aceite de responsabilidade obrigatório' });
      aceiteEm = String(Math.floor(Date.now() / 1000));
    }

    // STATE ASSINADO (29/set/2026, "Meta OAuth — assinar o state e validar no callback"): antes,
    // state era só base64url(`${uid}|${tipo}`) — sem assinatura. Como client_id e redirect_uri
    // são públicos, qualquer um montava a URL de autorização na mão com o uid de outra pessoa e o
    // callback (que APAGA a conexão anterior antes de inserir, ~163 de meta-callback.js)
    // sobrescrevia a conexão legítima da vítima. Agora o payload leva também a expiração (30min,
    // em epoch-segundos) e vem seguido de `.` + a assinatura HMAC-SHA256 (chave META_APP_SECRET,
    // já validada acima) do próprio payload em base64url — mesmo formato payload.assinatura já
    // usado pela Meta no signed_request da desautorização (tratarPost, acima neste projeto), só
    // que aqui quem assina somos nós. api/meta-callback.js recalcula e compara antes de trocar
    // qualquer coisa com a Meta.
    const crypto = require('crypto');
    const expiraEm = Math.floor(Date.now() / 1000) + 30 * 60; // 30min
    // 4º campo (só Ads): epoch do aceite de responsabilidade. O callback lê os 3 primeiros como antes.
    const payload = Buffer.from(`${uid}|${tipo}|${expiraEm}${aceiteEm ? '|' + aceiteEm : ''}`).toString('base64url');
    const assinatura = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('base64url');
    const state = `${payload}.${assinatura}`;

    // META ADS (02/out/2026): a Marketing API só aceita token do LOGIN DO FACEBOOK — antes o tipo
    // 'ads' mandava para o login do Instagram com escopos de ads, que nunca funcionou (nenhuma
    // conexão tipo='ads' chegou a existir). Fase 1 pede só ads_read (leitura); a fase 2 (montar
    // estrutura pausada) pedirá ads_management numa reconexão. O redirect é o mesmo
    // /api/meta-callback — precisa estar em "URIs de redirecionamento do OAuth válidos" do
    // produto Login do Facebook no painel do app.
    if (tipo === 'ads') {
      if (!fbAppId()) return res.status(503).json({ error: 'Meta não configurada' });
      // App do tipo EMPRESA não aceita o login clássico com `scope`: usa o "Login do Facebook para
      // Empresas", em que as permissões vêm de uma CONFIGURAÇÃO criada no painel (Login do Facebook
      // para Empresas → Configurações → criar configuração com ads_read) e o diálogo recebe só o
      // config_id. Com META_FB_LOGIN_CONFIG_ID definida, usa esse modo; sem ela, o clássico.
      const configId = String(process.env.META_FB_LOGIN_CONFIG_ID || '').trim();
      const url = `https://www.facebook.com/${ADS_GRAPH_V}/dialog/oauth`
        + `?client_id=${fbAppId()}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
        + (configId
          ? `&config_id=${encodeURIComponent(configId)}&override_default_response_type=true`
          : `&scope=${encodeURIComponent('ads_read')}&auth_type=rerequest`)
        + `&state=${state}`
        + `&response_type=code`;
      return res.status(200).json({ url });
    }

    // Instagram Business Login usa endpoint próprio e escopos do Instagram
    const scope = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights,instagram_business_manage_messages,instagram_business_manage_comments';

    // Endpoint do Instagram Business Login (diferente do Facebook dialog)
    const url = 'https://www.instagram.com/oauth/authorize'
      + `?client_id=${process.env.META_APP_ID}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&scope=${encodeURIComponent(scope)}`
      + `&state=${state}`
      + `&response_type=code`;

    return res.status(200).json({ url });
  } catch (e) {
    console.error('meta-oauth:', e.message);
    return res.status(500).json({ error: 'Erro ao iniciar conexão' });
  }
};
