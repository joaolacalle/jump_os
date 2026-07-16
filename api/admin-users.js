// api/admin-users.js — Backend de gestão (supervisor/admin)
// ENV: SUPABASE_SERVICE_KEY (service role). Valida o JWT do solicitante e aplica escopo.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const { salvarVideoNoBanco, zapCheckTask, checarRender, zapUpload, zapCriarTask, montarEdit, iniciarRender } = require('./_video-lib');
const { emailContaCriada } = require('./_email-lib');
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

const H = () => ({
  'apikey': KEY(),
  'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
});

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H() });
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: H(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Erro ao atualizar');
  return r.json();
}
async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error('Erro ao inserir: ' + t.slice(0, 120)); }
  return r.json();
}
async function sbUpsert(table, body) {
  // merge-duplicates: se a linha já existe (trigger criou), atualiza em vez de falhar
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...H(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Erro ao salvar: ' + t.slice(0, 120)); }
  return r.json();
}
async function authAdmin(path, method, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method, headers: H(), body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.msg || d.message || 'Erro de autenticação admin');
  return d;
}

function cortesiaDate(v) {
  if (!v) return null;
  if (v === 'ilimitado') return '2099-12-31T23:59:59Z';
  const dias = parseInt(v, 10);
  return isNaN(dias) ? null : new Date(Date.now() + dias * 864e5).toISOString();
}
// Tipo de cortesia: '7' = trial (cota reduzida); 30/60/ilimitado = cortesia paga (cota cheia)
function tipoCortesia(v) {
  if (!v) return null;
  return v === '7' ? 'trial' : 'cortesia';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    // 1. Identificar solicitante pelo JWT
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Não autenticado' });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': KEY(), 'Authorization': `Bearer ${jwt}` },
    });
    const requester = await uRes.json();
    if (!uRes.ok || !requester.id) return res.status(401).json({ error: 'Sessão inválida' });

    // 2. Papel do solicitante
    const [me] = await sbGet(`clientes?id=eq.${requester.id}&select=*`);
    const role = (me && me.role) || 'usuario';
    const { action: act0 } = req.body || {};

    // Solicitação de aumento de tokens — aberta a qualquer usuário autenticado
    if (act0 === 'request_tokens') {
      if (!me) return res.status(404).json({ error: 'Conta não encontrada' });
      // anti-spam: 1 solicitação pendente por vez
      const pend = await sbGet(`recados?tipo=eq.solicitacao_tokens&resposta=eq.${requester.id}&resolvido=eq.false&select=id`);
      if (Array.isArray(pend) && pend.length) {
        return res.status(400).json({ error: 'Você já tem uma solicitação aguardando o gestor.' });
      }
      let destinos = [];
      // Sempre notifica os admins; e também o supervisor direto, se houver
      const adms = await sbGet(`clientes?role=eq.admin&select=id`);
      destinos = (Array.isArray(adms) ? adms : []).map(a => a.id);
      if (me.supervisor_id && !destinos.includes(me.supervisor_id)) destinos.push(me.supervisor_id);
      if (!destinos.length) return res.status(400).json({ error: 'Nenhum gestor encontrado. Fale com o suporte.' });
      const uso = (me.uso || {}).tokens || 0, lim = (me.limites || {}).tokens || 0;
      const rows = destinos.map(d => ({
        user_id: d, tipo: 'solicitacao_tokens',
        titulo: `Solicitação de tokens — ${me.nome || me.email}`,
        mensagem: `${me.email} atingiu o limite mensal (${uso}/${lim} tokens) e pede aumento.`,
        resposta: requester.id, lido: false, resolvido: false,
      }));
      await sbInsert('recados', rows);
      return res.status(200).json({ ok: true });
    }

    // REMOVER ORDEM: o próprio usuário pode remover as SUAS ordens. Estava atrás do portão de
    // supervisor/admin → o usuário levava 403 e a tarefa nunca sumia. A checagem de dono é logo abaixo.
    if (act0 === 'cancelar_ordem') {
      const uid = requester.id;
      const isAdm = me && me.role === 'admin';
      const { ordem_id } = req.body;
      if (!ordem_id) return res.status(400).json({ error: 'ordem_id obrigatório' });
      const [o] = await sbGet(`ordens_servico?id=eq.${ordem_id}&select=user_id`);
      if (!o || (o.user_id !== uid && !isAdm)) return res.status(403).json({ error: 'Sem acesso' });
      await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico?id=eq.${ordem_id}`, { method: 'DELETE', headers: H() });
      return res.status(200).json({ ok: true });
    }

    if (role !== 'supervisor' && role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (me && me.bloqueado) return res.status(403).json({ error: 'Conta bloqueada' });

    const { action } = req.body || {};
    const isAdmin = role === 'admin';

    // Escopo: supervisor só atua nos próprios usuários
    async function assertScope(targetId) {
      if (isAdmin) return;
      const [t] = await sbGet(`clientes?id=eq.${targetId}&select=supervisor_id`);
      if (!t || t.supervisor_id !== requester.id) throw new Error('Fora do seu escopo de gestão');
    }

    // 3. Ações

    // ── list_all_users: lista via chave de serviço (bypassa RLS) — admin vê TODOS,
    //    supervisor vê os seus. Corrige o autocadastro órfão que a leitura por RLS escondia.
    if (action === 'list_all_users') {
      const q = isAdmin
        ? `clientes?select=*&order=created_at.desc`
        : `clientes?or=(supervisor_id.eq.${requester.id},id.eq.${requester.id})&select=*&order=created_at.desc`;
      const rows = await sbGet(q);
      return res.status(200).json({ ok: true, clientes: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'create_user' || action === 'create_supervisor' || action === 'create_admin') {
      const { nome, email, senha, plano, cortesia, telefone, cpf, endereco, limite_contas } = req.body;
      if (!nome || !email || !senha || senha.length < 6) {
        return res.status(400).json({ error: 'Dados incompletos (nome, e-mail, senha 6+)' });
      }
      const novoRole = action === 'create_admin' ? 'admin' : (action === 'create_supervisor' ? 'supervisor' : 'usuario');
      if (novoRole === 'supervisor' && !isAdmin) {
        return res.status(403).json({ error: 'Apenas admin cria supervisores' });
      }
      // Só o admin CEO (conta protegida) pode criar OUTROS admins
      if (novoRole === 'admin' && !(me && me.protegido)) {
        return res.status(403).json({ error: 'Apenas o administrador principal pode criar novos admins.' });
      }
      // Vagas do supervisor
      if (novoRole === 'usuario' && !isAdmin) {
        const meus = await sbGet(`clientes?supervisor_id=eq.${requester.id}&select=id,plano`);
        const limite = (me && me.limite_contas) || 0;
        if (limite && meus.length >= limite) {
          return res.status(400).json({ error: `Limite de ${limite} contas atingido` });
        }
        const cotas = (me && me.cotas) || {};
        const p = plano || 'plus';
        if (cotas[p] !== undefined && cotas[p] !== null && Number(cotas[p]) > 0) {
          const doPlano = meus.filter(u => u.plano === p).length;
          if (doPlano >= Number(cotas[p])) {
            return res.status(400).json({ error: `Cota de contas ${p} esgotada (${doPlano}/${cotas[p]})` });
          }
        }
      }
      // Verifica se o e-mail já existe no Auth (excluído incompleto deixa órfão)
      let novo;
      try {
        novo = await authAdmin('users', 'POST', {
          email, password: senha, email_confirm: true,
          user_metadata: { nome, plano: plano || 'plus' },
        });
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exists') || msg.includes('duplicate')) {
          return res.status(400).json({ error: 'Este e-mail já está cadastrado no sistema. Use outro e-mail, ou peça ao admin para excluir o cadastro antigo completamente antes de recriar.' });
        }
        throw e;
      }
      if (!novo || !novo.id) {
        return res.status(500).json({ error: 'Falha ao criar conta de acesso. Tente outro e-mail.' });
      }
      // Tokens por plano (config global) + trial
      let limTokens = 1000000;
      try {
        const cfgRows = await sbGet(`config?chave=in.(tokens_plano,trial)&select=chave,valor`);
        const cfg = {}; (cfgRows || []).forEach(r => cfg[r.chave] = r.valor);
        const planoFinal = plano || 'plus';
        if (cfg.tokens_plano && cfg.tokens_plano[planoFinal]) limTokens = Number(cfg.tokens_plano[planoFinal]);
        // se for cortesia/trial de 7 dias, aplica limite de trial
        if (cortesia === '7' && cfg.trial && cfg.trial.tokens) limTokens = Number(cfg.trial.tokens);
      } catch (e) {}
      // Linha em clientes
      const row = {
        id: novo.id, email, nome, role: novoRole,
        plano: plano || ((novoRole === 'supervisor' || novoRole === 'admin') ? null : 'plus'),
        status: 'ativo', bloqueado: false,
        telefone: telefone || null, cpf: cpf || null, endereco: endereco || null,
        cortesia_ate: cortesiaDate(cortesia),
        tipo_cortesia: tipoCortesia(cortesia),
        supervisor_id: novoRole === 'usuario' ? requester.id : null,
        limite_contas: novoRole === 'supervisor' ? (limite_contas || 10) : (novoRole === 'admin' ? 9999 : 0),
        limites: novoRole === 'usuario' ? { imagens: 100, videos: 20, trafego_sugestoes: 10, tokens: limTokens } : null,
      };
      // upsert: a trigger handle_new_user já pode ter criado a linha — fazemos merge
      await sbUpsert('clientes', row);
      await sbInsert('logs', { acao: `${role} criou ${novoRole}: ${email}`, user_id: requester.id }).catch(() => {});
      // envia o email de boas-vindas com os dados de acesso (só p/ conta de usuário)
      if (novoRole === 'usuario') {
        const nomeSup = (me && (me.nome || me.email)) || 'seu gestor';
        emailContaCriada(email, { nomeSupervisor: nomeSup, email, senha }).catch(() => {});
      }
      return res.status(200).json({ ok: true, id: novo.id });
    }

    if (action === 'update_user') {
      const { user_id, nome, telefone, cpf, endereco, cortesia, email } = req.body;
      await assertScope(user_id);
      const patch = {};
      if (nome !== undefined) patch.nome = nome;
      if (telefone !== undefined) patch.telefone = telefone;
      if (cpf !== undefined) patch.cpf = cpf;
      if (endereco !== undefined) patch.endereco = endereco;
      if (cortesia) { patch.cortesia_ate = cortesiaDate(cortesia); patch.tipo_cortesia = tipoCortesia(cortesia); }
      if (email) { await authAdmin(`users/${user_id}`, 'PUT', { email }); patch.email = email; }
      await sbPatch(`clientes?id=eq.${user_id}`, patch);
      return res.status(200).json({ ok: true });
    }

    if (action === 'get_planos') {
      const LIMS_DEFAULT = {
        basico: { imagens: 15, reloads: 5,  videos: 0,  tokens: 200000,  dm: 3, dm_envios: 0,   msgs: 600 },
        plus:   { imagens: 20, reloads: 8,  videos: 2,  tokens: 500000,  dm: 5, dm_envios: 100, msgs: 900 },
        pro:    { imagens: 30, reloads: 15, videos: 10, tokens: 1200000, dm: 8, dm_envios: 300, msgs: 1500 },
      };
      let planos = LIMS_DEFAULT;
      try {
        const pc = await sbGet(`config?chave=eq.planos&select=valor&limit=1`);
        if (Array.isArray(pc) && pc[0] && pc[0].valor) planos = { ...LIMS_DEFAULT, ...pc[0].valor };
      } catch (e) {}
      return res.status(200).json({ ok: true, planos });
    }

    if (action === 'set_planos') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin pode editar planos' });
      const { planos } = req.body;
      if (!planos || typeof planos !== 'object') return res.status(400).json({ error: 'planos inválido' });
      await sbUpsert('config', { chave: 'planos', valor: planos, updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true, planos });
    }

    if (action === 'set_plan') {
      const { user_id, plano } = req.body;
      if (!['basico', 'plus', 'pro'].includes(plano)) return res.status(400).json({ error: 'Plano inválido' });
      await assertScope(user_id);
      if (!isAdmin) {
        const cotas = (me && me.cotas) || {};
        if (cotas[plano] !== undefined && cotas[plano] !== null && Number(cotas[plano]) > 0) {
          const meus = await sbGet(`clientes?supervisor_id=eq.${requester.id}&plano=eq.${plano}&id=neq.${user_id}&select=id`);
          if (meus.length >= Number(cotas[plano])) {
            return res.status(400).json({ error: `Cota de contas ${plano} esgotada (${meus.length}/${cotas[plano]})` });
          }
        }
      }
      // Limites por plano: lê do banco (config 'planos'), com fallback aos defaults
      const LIMS_DEFAULT = {
        basico: { imagens: 15, reloads: 5,  videos: 0,  tokens: 200000,  dm: 3, dm_envios: 0,   msgs: 600 },
        plus:   { imagens: 20, reloads: 8,  videos: 2,  tokens: 500000,  dm: 5, dm_envios: 100, msgs: 900 },
        pro:    { imagens: 30, reloads: 15, videos: 10, tokens: 1200000, dm: 8, dm_envios: 300, msgs: 1500 },
      };
      let LIMS_PLANO = LIMS_DEFAULT;
      try {
        const pc = await sbGet(`config?chave=eq.planos&select=valor&limit=1`);
        if (Array.isArray(pc) && pc[0] && pc[0].valor) LIMS_PLANO = { ...LIMS_DEFAULT, ...pc[0].valor };
      } catch (e) {}
      // preserva limites existentes e sobrescreve os de imagem/reload do plano
      const cliAtual = (await sbGet(`clientes?id=eq.${user_id}&select=limites`))[0] || {};
      const novoLim = { ...(cliAtual.limites || {}), ...(LIMS_PLANO[plano] || LIMS_DEFAULT[plano]) };
      await sbPatch(`clientes?id=eq.${user_id}`, { plano, limites: novoLim });
      return res.status(200).json({ ok: true, limites: novoLim });
    }

    if (action === 'set_limits') {
      const { user_id, limites } = req.body;
      await assertScope(user_id);
      // TETO DE TOKENS: se quem está definindo é supervisor (não admin), a soma de
      // tokens de TODAS as contas dele não pode ultrapassar o teto definido pelo admin.
      if (!isAdmin) {
        const teto = Number((me && me.teto_tokens) || 0);
        if (teto > 0) {
          // soma os tokens das outras contas do supervisor (exceto a que está sendo editada)
          const minhas = await sbGet(`clientes?supervisor_id=eq.${requester.id}&select=id,limites`);
          let somaOutras = 0;
          for (const cc of (Array.isArray(minhas) ? minhas : [])) {
            if (cc.id === user_id) continue;
            somaOutras += Number((cc.limites && cc.limites.tokens) || 0);
          }
          const novoTotal = somaOutras + Number((limites && limites.tokens) || 0);
          if (novoTotal > teto) {
            const disp = Math.max(0, teto - somaOutras);
            return res.status(400).json({ error: `Teto de tokens excedido. Seu limite total é ${teto.toLocaleString('pt-BR')} tokens; já distribuiu ${somaOutras.toLocaleString('pt-BR')} nas outras contas. Disponível para esta conta: ${disp.toLocaleString('pt-BR')}.` });
          }
        }
      }
      await sbPatch(`clientes?id=eq.${user_id}`, { limites });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_tema') {
      const { user_id, tema } = req.body;
      await assertScope(user_id);
      await sbPatch(`clientes?id=eq.${user_id}`, { tema });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_dados') {
      const { user_id, nome, telefone } = req.body;
      await assertScope(user_id);
      const patch = {};
      if (nome !== undefined) patch.nome = nome;
      if (telefone !== undefined) patch.telefone = telefone;
      await sbPatch(`clientes?id=eq.${user_id}`, patch);
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_cortesia') {
      const { user_id, cortesia } = req.body;
      await assertScope(user_id);
      await sbPatch(`clientes?id=eq.${user_id}`, { cortesia_ate: cortesiaDate(cortesia), tipo_cortesia: tipoCortesia(cortesia) });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_limite_contas') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { user_id, limite_contas } = req.body;
      await sbPatch(`clientes?id=eq.${user_id}`, { limite_contas });
      return res.status(200).json({ ok: true });
    }

    if (action === 'block_user') {
      const { user_id, bloqueado } = req.body;
      await assertScope(user_id);
      await sbPatch(`clientes?id=eq.${user_id}`, { bloqueado: !!bloqueado });
      await sbInsert('logs', { acao: `${bloqueado ? 'Bloqueio' : 'Desbloqueio'}: ${user_id}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_password') {
      const { user_id } = req.body;
      await assertScope(user_id);
      const [t] = await sbGet(`clientes?id=eq.${user_id}&select=email`);
      if (!t) return res.status(404).json({ error: 'Usuário não encontrado' });
      const link = await authAdmin('generate_link', 'POST', { type: 'recovery', email: t.email });
      return res.status(200).json({ ok: true, link: link.action_link || (link.properties && link.properties.action_link) || null });
    }

    if (action === 'send_recado') {
      const { user_id, tipo, titulo, mensagem } = req.body;
      if (!titulo || !mensagem) return res.status(400).json({ error: 'Título e mensagem obrigatórios' });
      await assertScope(user_id);
      await sbInsert('recados', { user_id, tipo: tipo || 'info', titulo, mensagem, lido: false, resolvido: false });
      return res.status(200).json({ ok: true });
    }

    if (action === 'broadcast') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { tipo, titulo, mensagem } = req.body;
      if (!titulo || !mensagem) return res.status(400).json({ error: 'Título e mensagem obrigatórios' });
      const todos = await sbGet(`clientes?role=eq.usuario&select=id`);
      const rows = (todos || []).map(u => ({ user_id: u.id, tipo: tipo || 'info', titulo, mensagem, lido: false, resolvido: false }));
      if (rows.length) await sbInsert('recados', rows);
      await sbInsert('logs', { acao: `Broadcast: ${titulo}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true, count: rows.length });
    }

    if (action === 'transfer_user') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin transfere contas' });
      const { user_id, novo_supervisor_id } = req.body;
      if (!user_id || !novo_supervisor_id) return res.status(400).json({ error: 'Dados incompletos' });
      const [dest] = await sbGet(`clientes?id=eq.${novo_supervisor_id}&select=id,role,limite_contas,email`);
      if (!dest || (dest.role !== 'supervisor' && dest.role !== 'admin')) {
        return res.status(400).json({ error: 'Destino não é um supervisor válido' });
      }
      if (dest.limite_contas) {
        const atuais = await sbGet(`clientes?supervisor_id=eq.${novo_supervisor_id}&select=id`);
        if (atuais.length >= dest.limite_contas) {
          return res.status(400).json({ error: `Supervisor de destino sem vagas (${atuais.length}/${dest.limite_contas})` });
        }
      }
      await sbPatch(`clientes?id=eq.${user_id}`, { supervisor_id: novo_supervisor_id });
      await sbInsert('logs', { acao: `Transferência: usuário ${user_id} → supervisor ${dest.email}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_password') {
      const { user_id, senha } = req.body;
      if (!senha || senha.length < 6) return res.status(400).json({ error: 'Senha precisa de 6+ caracteres' });
      await assertScope(user_id);
      await authAdmin(`users/${user_id}`, 'PUT', { password: senha });
      await sbInsert('logs', { acao: `Senha redefinida para ${user_id}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_user') {
      const { user_id } = req.body;
      await assertScope(user_id);
      const [t] = await sbGet(`clientes?id=eq.${user_id}&select=role,email,protegido`);
      if (t && t.protegido) return res.status(403).json({ error: 'Esta conta é protegida (administrador principal) e não pode ser excluída.' });
      // Admins só podem ser excluídos pelo admin CEO (conta protegida)
      if (t && t.role === 'admin' && !(me && me.protegido)) {
        return res.status(403).json({ error: 'Apenas o administrador principal pode excluir admins.' });
      }
      if (t && t.role === 'supervisor' && !isAdmin) return res.status(403).json({ error: 'Apenas admin exclui supervisores' });
      // Exclusão COMPLETA — remove de todas as tabelas + Auth (evita órfãos)
      await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/memorias?user_id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/chat_mensagens?user_id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/contas_conectadas?user_id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      try { await authAdmin(`users/${user_id}`, 'DELETE'); } catch (e) { /* já pode ter sido removido */ }
      await sbInsert('logs', { acao: `Conta excluída: ${(t && t.email) || user_id}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'limpar_email') {
      // Admin: remove completamente um e-mail órfão (Auth + clientes) para poder recriar
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
      // acha no Auth pela listagem
      let removed = false;
      try {
        const list = await authAdmin(`users?filter=${encodeURIComponent('email.eq.' + email)}`, 'GET');
        const users = (list && list.users) || [];
        for (const u of users) {
          await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${u.id}`, { method: 'DELETE', headers: H() }).catch(() => {});
          await authAdmin(`users/${u.id}`, 'DELETE').catch(() => {});
          removed = true;
        }
      } catch (e) {}
      // limpa linha em clientes pelo email também
      await fetch(`${SUPABASE_URL}/rest/v1/clientes?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: H() }).catch(() => {});
      return res.status(200).json({ ok: true, removed });
    }

    if (action === 'set_cotas') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin define cotas' });
      const { user_id, cotas, teto_tokens } = req.body;
      const patch = { cotas };
      if (teto_tokens !== undefined) patch.teto_tokens = Number(teto_tokens) || 0;
      await sbPatch(`clientes?id=eq.${user_id}`, patch);
      return res.status(200).json({ ok: true });
    }

    if (action === 'get_config') {
      const rows = await sbGet(`config?select=chave,valor`);
      const cfg = {};
      (Array.isArray(rows) ? rows : []).forEach(r => cfg[r.chave] = r.valor);
      return res.status(200).json({ ok: true, config: cfg });
    }

    if (action === 'set_config') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { chave, valor } = req.body;
      if (!chave || valor === undefined) return res.status(400).json({ error: 'Dados incompletos' });
      await sbUpsert('config', { chave, valor, updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    // ═══ SUPORTE JUMP (SAC interno com IA) ═══

    // Manual do sistema (base de conhecimento da IA)
    const MANUAL_JUMP = `MANUAL DO JUMP OS (para responder dúvidas dos usuários):

═══ COMO COMEÇAR (ONBOARDING) ═══
Ao entrar pela primeira vez, o usuário faz o CHECK-IN com o Agente de Identidade (conta o que faz, público, objetivos). A partir daí há DOIS caminhos:
- CAMINHO A (estratégia do zero): a pessoa quer que a IA monte tudo. Oriente: 1) faça o check-in no Agente de Identidade; 2) peça ao Agente de Mercado pra analisar concorrentes; 3) vá ao Agente de Estratégia e peça o calendário do mês; 4) o Criativo gera as artes; 5) aprove em "Aprovar". O sistema sugere e a pessoa só aprova.
- CAMINHO B (já tem estratégia própria): a pessoa já sabe o que postar. Oriente: faça o check-in rápido, depois leve seu conteúdo direto ao Agente de Estratégia (ou Publicação) preenchendo o que já tem; o sistema adapta as copies e organiza. Use o botão "Enviar conteúdo" no Agente de Publicação pra subir um criativo pronto e gerar a copy.
Em ambos: o objetivo é não deixar dúvida. Se a pessoa estiver perdida, pergunte em qual caminho ela se encaixa e guie passo a passo.

CONECTAR INSTAGRAM: Menu "Conectar contas". A conta precisa ser Business ou Creator (não pessoal). O token dura 60 dias e o sistema renova sozinho. Se aparecer "reconecte", é só refazer a conexão.

OS 8 AGENTES:
- Identidade: define o DNA da marca (cores, tom de voz, público).
- Mercado: analisa concorrentes e acha oportunidades.
- Diagnóstico: lê as métricas reais do Instagram.
- Estratégia: monta o calendário e as copies do mês.
- Criativo: gera as imagens e artes.
- Publicação (Plus+): agenda posts e cria campanhas de DM automática.
- Tráfego (Pro): gerencia anúncios (Meta Ads).
- Editor de Vídeo (Pro): edita Reels.

CICLO MENSAL: Todo dia 25 chega o aviso para gerar a estratégia do mês seguinte. Abra o Agente de Estratégia e clique em gerar.

APROVAR CONTEÚDO: O conteúdo gerado aparece em "Aprovar". Você revisa e aprova com um clique. Imagens podem ser recriadas (reload) se não gostar.

LIMITES (por mês, variam por plano): imagens (criações), saldo extra (reloads/promoções), vídeos, tokens de texto e palavras-chave de DM. O texto/conversa com os agentes é livre.

TRIAL E COBRANÇA: Novos assinantes têm 7 dias de teste com cota reduzida. Após 7 dias, a cota completa do plano é liberada. Dá para ativar a assinatura antes nas Configurações. Reembolso segue o CDC (7 dias).

PROMOÇÃO/DM: No Agente de Publicação, botão "Criar campanha DM" no topo. Define palavra-chave + mensagem + link. Quando alguém comenta a palavra, o sistema responde no direct.

═══ PASSO A PASSO: SUBIR E EDITAR UM VÍDEO ═══
1. Abra o Agente "Editor de Vídeo" (plano Pro).
2. Clique em "Subir vídeo" — abre o pop-up.
3. Clique na área de upload e escolha o vídeo (MP4/MOV, até 100 MB).
4. Marque o que quer: Legendas automáticas (escolha a fonte e a cor), Cortar trecho, Velocidade, Filtro, Texto na tela, Trilha sonora (escolha o estilo), Logo, e o Formato (Reels 9:16 ou Paisagem). Se for vídeo de vendas, marque "É uma VSL" (legenda mais ao centro).
5. Clique em "Editar vídeo". O sistema gera as legendas, processa e fica pronto em alguns minutos.
6. Acompanhe o andamento na Central de Ordens (aba "Vídeos"): mostra se está gerando legenda, processando, pronto ou se deu erro.

═══ PASSO A PASSO: BAIXAR UM VÍDEO ═══
Quando o vídeo fica pronto, aparece o botão "Baixar" (no chat, na Central de Ordens aba Vídeos, e em Meus Arquivos aba "Vídeos editados"). Clique para baixar. Dica: baixe logo que ficar pronto. Ao baixar, o vídeo original (cru) é apagado para liberar espaço.

═══ PASSO A PASSO: CALENDÁRIO / PLANNER ═══
O calendário de conteúdo fica no menu "Calendário". O Agente de Estratégia gera os posts do mês (botão "Gerar calendário do mês"). Os itens aparecem no calendário e em "Aprovar". Você revisa, aprova ou pede pra recriar.

═══ PASSO A PASSO: CONFIGURAR META ADS (parte manual do usuário) ═══
O Agente de Tráfego (Pro) monta a ESTRATÉGIA do anúncio (público, orçamento, copy), mas a criação da campanha no Gerenciador de Anúncios da Meta é feita por você, manualmente. Passos gerais:
1. Tenha uma conta no Gerenciador de Anúncios (business.facebook.com) e um método de pagamento configurado.
2. No Gerenciador, clique em "Criar" e escolha o objetivo (ex: Tráfego, Engajamento ou Conversões) conforme o Agente de Tráfego sugerir.
3. Defina o público (o Agente de Tráfego te dá as características: idade, localização, interesses).
4. Defina o orçamento diário e o período.
5. No anúncio, use a copy e o criativo que os agentes geraram.
6. Revise e publique. Acompanhe os resultados e traga as métricas de volta ao Agente de Tráfego pra ele sugerir ajustes.
Se a pessoa tiver dúvida específica de algum botão da Meta, oriente de forma geral e sugira a central de ajuda da Meta, pois a interface deles muda com frequência.

═══ TAREFAS E ORDENS ═══
Qualquer agente tem o botão "Incluir ordem" pra criar uma tarefa (ex: "criar promoção toda 1ª semana"). As ordens ficam na Central de Ordens, onde dá pra executar ("Executar agora"), ver o andamento dos vídeos e acompanhar o histórico.

PROBLEMAS COMUNS: Se algo não carregar, recarregue a página (no celular, force o recarregamento ou use aba anônima). Se o Instagram desconectar, reconecte em "Conectar contas". No celular, o menu lateral abre pelo botão ☰ no topo. Para aumentar limites/tokens, relatar bugs, reembolso ou cancelamento, use este chat que eu encaminho ao suporte humano.`;

    // USUÁRIO conversa com o Suporte JUMP (IA responde; abre ticket se necessário)
    if (action === 'suporte_chat') {
      const { mensagem, ticket_id } = req.body;
      if (!mensagem) return res.status(400).json({ error: 'Mensagem vazia' });
      const uid = requester.id;
      let tid = ticket_id;
      // histórico do ticket (se já existe)
      let historico = [];
      if (tid) {
        const msgs = await sbGet(`suporte_mensagens?ticket_id=eq.${tid}&order=created_at.asc&select=autor,texto`);
        historico = Array.isArray(msgs) ? msgs : [];
      }
      // grava a mensagem do usuário (cria ticket se ainda não há)
      if (!tid) {
        const novo = await sbInsert('suporte_tickets', { user_id: uid, assunto: mensagem.slice(0, 60), status: 'aberto' });
        tid = Array.isArray(novo) && novo[0] ? novo[0].id : null;
      }
      if (tid) await sbInsert('suporte_mensagens', { ticket_id: tid, autor: 'usuario', texto: mensagem });

      // dados do usuário p/ contexto (plano, limites, uso)
      const [cli] = await sbGet(`clientes?id=eq.${uid}&select=nome,plano,limites,uso,cortesia_ate,tipo_cortesia`);
      const ctxUser = cli ? `Usuário: ${cli.nome||''} | Plano: ${cli.plano||'?'} | Uso de imagens: ${(cli.uso&&cli.uso.imagens)||0}/${(cli.limites&&cli.limites.imagens)||0}` : '';
      const histTxt = historico.map(m => `${m.autor === 'usuario' ? 'Usuário' : m.autor === 'admin' ? 'Suporte (humano)' : 'Você'}: ${m.texto}`).join('\n');

      const sys = `Você é o "Suporte JUMP", o assistente de suporte do JUMP OS. Ajude o usuário com dúvidas de uso de forma clara, simpática e objetiva, em português. Use o MANUAL abaixo como fonte. Se a dúvida for respondível pelo manual, responda direto e bem.

REGRAS:
- Se o usuário pede algo que precisa de um humano (aumento de limites/tokens, relatar um bug que você não resolve, reembolso, cancelamento, problema na conta), responda acolhendo e diga que vai ENCAMINHAR ao suporte. Então TERMINE sua resposta com a tag [TICKET:categoria] onde categoria é uma de: tokens, problema, sugestao, outro.
- Se for só dúvida de uso que você resolveu, NÃO use a tag.
- Seja conciso. Escreva limpo, sem markdown pesado.

${MANUAL_JUMP}

CONTEXTO DO USUÁRIO: ${ctxUser}`;
      const userMsg = histTxt ? `CONVERSA ATÉ AGORA:\n${histTxt}\n\nNOVA MENSAGEM: ${mensagem}` : mensagem;

      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, system: sys, messages: [{ role: 'user', content: userMsg }] }),
        });
        const ai = await aiRes.json();
        let txt = (ai.content && ai.content[0] && ai.content[0].text) || 'Desculpe, tente de novo.';
        // detectar tag de ticket
        let categoria = null;
        const m = txt.match(/\[TICKET:(\w+)\]/);
        if (m) { categoria = m[1]; txt = txt.replace(/\[TICKET:\w+\]/, '').trim(); }
        // grava resposta da IA
        if (tid) await sbInsert('suporte_mensagens', { ticket_id: tid, autor: 'ia', texto: txt });
        // se virou ticket p/ humano, marca categoria/prioridade e avisa admin
        if (categoria && tid) {
          await sbPatch(`suporte_tickets?id=eq.${tid}`, { categoria, status: 'aberto', prioridade: categoria === 'problema' ? 'alta' : 'normal' });
          const adms = await sbGet(`clientes?role=eq.admin&select=id`);
          for (const a of (Array.isArray(adms) ? adms : [])) {
            await sbInsert('recados', { user_id: a.id, tipo: 'suporte', titulo: 'Novo chamado de suporte', mensagem: `${(cli&&cli.nome)||'Usuário'}: ${mensagem.slice(0,80)} [ticket:${tid}]`, lido: false, resolvido: false }).catch(()=>{});
          }
        }
        return res.status(200).json({ ok: true, resposta: txt, ticket_id: tid, virou_ticket: !!categoria });
      } catch (e) {
        return res.status(500).json({ error: 'Falha ao responder' });
      }
    }

    // USUÁRIO lista seus tickets
    if (action === 'suporte_meus_tickets') {
      const uid = requester.id;
      const tickets = await sbGet(`suporte_tickets?user_id=eq.${uid}&order=updated_at.desc&select=*`);
      return res.status(200).json({ ok: true, tickets: Array.isArray(tickets) ? tickets : [] });
    }

    // USUÁRIO/ADMIN carrega as mensagens de um ticket
    if (action === 'suporte_ticket_msgs') {
      const { ticket_id } = req.body;
      if (!ticket_id) return res.status(400).json({ error: 'ticket_id obrigatório' });
      // valida acesso: dono ou admin
      const [tk] = await sbGet(`suporte_tickets?id=eq.${ticket_id}&select=user_id`);
      if (!tk) return res.status(404).json({ error: 'Ticket não encontrado' });
      if (!isAdmin && tk.user_id !== requester.id) return res.status(403).json({ error: 'Sem acesso' });
      const msgs = await sbGet(`suporte_mensagens?ticket_id=eq.${ticket_id}&order=created_at.asc&select=*`);
      return res.status(200).json({ ok: true, mensagens: Array.isArray(msgs) ? msgs : [] });
    }

    // ADMIN lista todos os tickets (com filtro de status)
    if (action === 'suporte_admin_tickets') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const status = (req.body && req.body.status) || '';
      const filtro = status ? `&status=eq.${status}` : '';
      const tickets = await sbGet(`suporte_tickets?order=updated_at.desc${filtro}&select=*`);
      const arr = Array.isArray(tickets) ? tickets : [];
      // anexa nome/email do usuário
      for (const t of arr) {
        const [u] = await sbGet(`clientes?id=eq.${t.user_id}&select=nome,email`);
        t.usuario_nome = u ? (u.nome || u.email) : '—';
      }
      return res.status(200).json({ ok: true, tickets: arr });
    }

    // ADMIN responde um ticket (a resposta volta ao usuário no mesmo chat)
    if (action === 'suporte_responder') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { ticket_id, texto, resolver } = req.body;
      if (!ticket_id || !texto) return res.status(400).json({ error: 'Dados incompletos' });
      await sbInsert('suporte_mensagens', { ticket_id, autor: 'admin', texto });
      await sbPatch(`suporte_tickets?id=eq.${ticket_id}`, { status: resolver ? 'resolvido' : 'respondido', resolvido_em: resolver ? new Date().toISOString() : null });
      // avisa o usuário dono do ticket
      const [tk] = await sbGet(`suporte_tickets?id=eq.${ticket_id}&select=user_id`);
      if (tk) await sbInsert('recados', { user_id: tk.user_id, tipo: 'suporte_resposta', titulo: 'O suporte respondeu', mensagem: `Sua solicitação teve uma resposta. [ticket:${ticket_id}]`, lido: false, resolvido: false }).catch(()=>{});
      return res.status(200).json({ ok: true });
    }

    // ── AGENTE DE SEGURANÇA: dados/alertas do sistema (só admin) ──
    if (action === 'security_data') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const agora = Date.now();
      const h24 = new Date(agora - 24*3600*1000).toISOString();
      const h1 = new Date(agora - 3600*1000).toISOString();
      // Coletas para o painel
      const [todos, recentes24, logs1h, alertas] = await Promise.all([
        sbGet(`clientes?select=id,email,plano,status,bloqueado,cortesia_ate,tipo_cortesia,created_at,uso`),
        sbGet(`clientes?created_at=gte.${h24}&select=id,email,created_at,cpf&order=created_at.desc`),
        sbGet(`logs?created_at=gte.${h1}&select=id,acao,user_id&order=created_at.desc&limit=50`),
        sbGet(`recados?tipo=eq.seguranca&resolvido=eq.false&select=id,titulo,mensagem,created_at&order=created_at.desc&limit=20`),
      ]);
      const arr = Array.isArray(todos) ? todos : [];
      // Detecções rápidas (heurísticas)
      const flags = [];
      // 1) muitas contas criadas nas últimas 24h
      const novas = Array.isArray(recentes24) ? recentes24 : [];
      if (novas.length >= 5) flags.push({ nivel: 'alerta', txt: `${novas.length} contas criadas nas últimas 24h` });
      // 2) CPF repetido
      const cpfMap = {};
      arr.forEach(c => { if (c.cpf) cpfMap[c.cpf] = (cpfMap[c.cpf]||0)+1; });
      Object.entries(cpfMap).filter(([_,n]) => n > 1).forEach(([cpf,n]) =>
        flags.push({ nivel: 'alerta', txt: `CPF repetido em ${n} contas (final ${String(cpf).slice(-4)})` }));
      // 3) uso de imagens muito acima do normal (possível abuso)
      arr.forEach(c => {
        const img = c.uso && c.uso.imagens ? Number(c.uso.imagens) : 0;
        if (img > 50) flags.push({ nivel: 'info', txt: `${c.email}: ${img} imagens este mês` });
      });
      return res.status(200).json({
        ok: true,
        resumo: {
          total: arr.length,
          ativos: arr.filter(c => c.status === 'ativo' && !c.bloqueado).length,
          bloqueados: arr.filter(c => c.bloqueado).length,
          trial: arr.filter(c => c.tipo_cortesia === 'trial' && c.cortesia_ate && new Date(c.cortesia_ate) > new Date()).length,
          novas24h: novas.length,
        },
        flags,
        alertas: Array.isArray(alertas) ? alertas : [],
        logs: Array.isArray(logs1h) ? logs1h : [],
      });
    }

    // ── AGENTE DE SEGURANÇA: chat de consulta (IA com contexto do sistema) ──
    if (action === 'security_chat') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin' });
      const { pergunta } = req.body;
      if (!pergunta) return res.status(400).json({ error: 'Pergunta vazia' });
      // Coleta um panorama do sistema para dar contexto ao agente
      const clientes = await sbGet(`clientes?select=email,plano,status,bloqueado,tipo_cortesia,cortesia_ate,uso,created_at`);
      const arr = Array.isArray(clientes) ? clientes : [];
      const panorama = {
        total: arr.length,
        por_plano: arr.reduce((a,c)=>{a[c.plano||'?']=(a[c.plano||'?']||0)+1;return a;},{}),
        ativos: arr.filter(c=>c.status==='ativo'&&!c.bloqueado).length,
        bloqueados: arr.filter(c=>c.bloqueado).length,
        em_trial: arr.filter(c=>c.tipo_cortesia==='trial').length,
        top_uso_imagens: arr.map(c=>({email:c.email,img:(c.uso&&c.uso.imagens)||0})).sort((a,b)=>b.img-a.img).slice(0,5),
      };
      const sys = `Você é o AGENTE DE SEGURANÇA do JUMP OS — assistente do administrador (João). Responda de forma direta, objetiva e em português, como um analista de segurança e operações. Use os DADOS REAIS do sistema fornecidos. Se perguntarem algo que os dados não cobrem, diga o que seria preciso verificar. Aponte riscos (fraude, abuso de trial, uso anormal) quando relevante. Seja conciso. NÃO invente números — use só os dados dados. Escreva limpo, sem markdown pesado.`;
      const userMsg = `PERGUNTA DO ADMIN: ${pergunta}\n\nDADOS ATUAIS DO SISTEMA (JSON):\n${JSON.stringify(panorama)}`;
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, system: sys, messages: [{ role: 'user', content: userMsg }] }),
        });
        const ai = await aiRes.json();
        const txt = (ai.content && ai.content[0] && ai.content[0].text) || 'Não consegui processar agora.';
        return res.status(200).json({ ok: true, resposta: txt });
      } catch (e) {
        return res.status(500).json({ error: 'Falha ao consultar o agente' });
      }
    }

    // ── EDITOR DE VÍDEO: listar meus jobs ──
    if (action === 'video_meus_jobs') {
      const uid = requester.id;
      const jobs = await sbGet(`video_jobs?user_id=eq.${uid}&order=created_at.desc&limit=30&select=*`);
      const lista = Array.isArray(jobs) ? jobs : [];
      // Máquina de estados (não depende de webhook): processa SÓ os jobs pendentes
      // e no MÁXIMO 1 por chamada (evita timeout/erro de conexão na Vercel 60s)
      // FLUXO HÍBRIDO: processa 1 job pendente por chamada.
      // render_id pode ser 'shot:renderId' (fase Shotstack) ou 'zap:videoId:taskId' (fase ZapCap).
      if (process.env.ZAPCAP_API_KEY || process.env.SHOTSTACK_API_KEY) {
        const pendentes = lista.filter(j => j.status === 'processando' && j.render_id);
        const aProcessar = pendentes.slice(0, 1);
        for (const j of aProcessar) {
          try {
            // ── FASE SHOTSTACK (composição) ──
            if (j.render_id.startsWith('shot:')) {
              const renderId = j.render_id.slice(5);
              const rr = await checarRender(renderId);
              if (rr.done && rr.url) {
                // Shotstack terminou. Precisa ir pro ZapCap (legenda/corte)?
                if (j.salvo_path === 'fase2:zapcap' && process.env.ZAPCAP_API_KEY) {
                  const up = await zapUpload(rr.url);
                  if (up.error) { await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'erro', erro: 'Falha ao enviar p/ legenda: ' + up.error }); j.status = 'erro'; }
                  else {
                    const tk = await zapCriarTask(up.videoId, j.operacoes || {});
                    if (tk.error) { await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'erro', erro: 'Falha na legenda: ' + tk.error }); j.status = 'erro'; }
                    else { await sbPatch(`video_jobs?id=eq.${j.id}`, { render_id: 'zap:' + up.videoId + ':' + tk.taskId, salvo_path: null }); j.render_id = 'zap:' + up.videoId + ':' + tk.taskId; }
                  }
                } else {
                  // Só Shotstack (sem legenda): terminou, está pronto.
                  await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'pronto', resultado_url: rr.url, updated_at: new Date().toISOString() });
                  j.status = 'pronto'; j.resultado_url = rr.url;
                }
              } else if (rr.failed) {
                await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'erro', erro: 'Falha ao compor: ' + (rr.motivo || 'sem detalhe') });
                j.status = 'erro';
              }
            }
            // ── FASE ZAPCAP (legenda + corte silêncio) ──
            else if (j.render_id.startsWith('zap:')) {
              const partes = j.render_id.split(':');
              const videoId = partes[1], taskId = partes[2];
              const rr = await zapCheckTask(videoId, taskId);
              if (rr.done && rr.url) {
                // ZapCap terminou. Precisa ir pro Shotstack (composição: trilha/logo/áudio)?
                if (j.salvo_path === 'fase2:shot' && process.env.SHOTSTACK_API_KEY) {
                  const edit = montarEdit(rr.url, j.operacoes || {}, null);
                  const rn = await iniciarRender(edit);
                  if (rn.error) { await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'erro', erro: 'Falha na composição: ' + rn.error }); j.status = 'erro'; }
                  else { await sbPatch(`video_jobs?id=eq.${j.id}`, { render_id: 'shot:' + rn.render_id, salvo_path: null }); j.render_id = 'shot:' + rn.render_id; }
                } else {
                  await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'pronto', resultado_url: rr.url, updated_at: new Date().toISOString() });
                  j.status = 'pronto'; j.resultado_url = rr.url;
                }
              } else if (rr.failed) {
                await sbPatch(`video_jobs?id=eq.${j.id}`, { status: 'erro', erro: 'Erro na legenda: ' + (rr.motivo || 'sem detalhe') });
                j.status = 'erro';
              }
            }
          } catch (e) { /* ignora, tenta na próxima batida */ }
        }
      }
      return res.status(200).json({ ok: true, jobs: lista });
    }
    // ── EDITOR DE VÍDEO: status de um job (polling) ──
    if (action === 'video_status') {
      const { job_id } = req.body;
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      const [j] = await sbGet(`video_jobs?id=eq.${job_id}&select=*`);
      if (!j) return res.status(404).json({ error: 'Job não encontrado' });
      if (!isAdmin && j.user_id !== requester.id) return res.status(403).json({ error: 'Sem acesso' });
      return res.status(200).json({ ok: true, job: j });
    }

    // ── ENVIAR CONTEÚDO: cria OS p/ a Estratégia gerar a copy do criativo ──
    if (action === 'criar_os_copy') {
      const uid = requester.id;
      const { criativo_url, criativo_tipo, tema, data_sugerida, formato } = req.body;
      if (!criativo_url || !tema) return res.status(400).json({ error: 'Envie o criativo e o tema.' });
      const detalhe = `O cliente enviou um criativo (${criativo_tipo || 'imagem'}) pronto e quer a legenda/copy para ele. ` +
        `Tema: ${tema}. Formato: ${formato || 'feed'}.${data_sugerida ? ` Data sugerida: ${data_sugerida}.` : ''} ` +
        `Crie a copy completa (headline + legenda + hashtags + CTA) no tom da marca e registre com a tag <conteudo> usando este criativo. ` +
        `URL do criativo: ${criativo_url}`;
      await sbInsert('ordens_servico', {
        user_id: uid, de_agente: 'publicacao', para_agente: 'estrategia',
        tarefa: 'copy_para_criativo', detalhe, status: 'pendente',
      });
      // avisa que há uma ordem (registro leve; o Estrategista atende quando aberto)
      return res.status(200).json({ ok: true });
    }

    // ── INCLUIR ORDEM: usuário cria uma ordem que modela o negócio ──
    if (action === 'criar_ordem_usuario') {
      const uid = requester.id;
      const { para_agente, tarefa, recorrencia, recurso, quantidade } = req.body;
      if (!para_agente || !tarefa) return res.status(400).json({ error: 'Informe o agente e a tarefa.' });
      // valida saldo no servidor (defesa real, além do aviso no front)
      if (recurso && quantidade) {
        const [c2] = await sbGet(`clientes?id=eq.${uid}&select=limites,uso`);
        const lim = (c2 && c2.limites) || {};
        const uso = (c2 && c2.uso) || {};
        const mesAtual = new Date().toISOString().slice(0, 7);
        const usado = (uso.mes === mesAtual) ? Number(uso[recurso] || 0) : 0;
        const resta = Math.max(0, Number(lim[recurso] ?? 0) - usado);
        if (Number(quantidade) > resta) {
          return res.status(400).json({ error: `Sua ordem pede ${quantidade}, mas você só tem ${resta} de saldo de ${recurso} este mês.` });
        }
      }
      const detalheFull = (recurso && quantidade) ? `${tarefa} [consome ${quantidade} ${recurso}]` : tarefa;
      await sbInsert('ordens_servico', {
        user_id: uid, de_agente: 'usuario', para_agente,
        tarefa: recorrencia ? `recorrente_${recorrencia}` : 'tarefa_usuario',
        detalhe: detalheFull, status: 'pendente',
        recorrencia: recorrencia || null,
      });
      return res.status(200).json({ ok: true });
    }

    // ── CENTRAL DE ORDENS: lista as ordens do usuário (pendentes + concluídas) ──
    if (action === 'minhas_ordens') {
      const uid = requester.id;
      const ordens = await sbGet(`ordens_servico?user_id=eq.${uid}&order=created_at.desc&limit=60&select=*`);
      return res.status(200).json({ ok: true, ordens: Array.isArray(ordens) ? ordens : [] });
    }

    // ── CENTRAL DE ORDENS: cancelar/remover uma ordem ──

    // ── TEMPLATES ZAPCAP: lista os estilos de legenda disponíveis ──
    if (action === 'video_templates') {
      const key = process.env.ZAPCAP_API_KEY;
      if (!key) return res.status(200).json({ ok: true, templates: [] });
      try {
        const r = await fetch('https://api.zapcap.ai/templates', { headers: { 'x-api-key': key } });
        const d = await r.json();
        // a API retorna um array de {id, name, previewUrl?}
        const templates = Array.isArray(d) ? d : (d.templates || d.data || []);
        return res.status(200).json({ ok: true, templates });
      } catch (e) {
        return res.status(200).json({ ok: true, templates: [], erro: e.message });
      }
    }

    // ── SALVAR VÍDEO NO BANCO: copia o pronto do Shotstack pro nosso Storage ──
    if (action === 'video_salvar') {
      const uid = requester.id;
      const { job_id } = req.body;
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      const [j] = await sbGet(`video_jobs?id=eq.${job_id}&select=user_id,resultado_url,salvo_url,status`);
      if (!j || (j.user_id !== uid && !isAdmin)) return res.status(403).json({ error: 'Sem acesso' });
      if (j.salvo_url) return res.status(200).json({ ok: true, salvo_url: j.salvo_url, ja: true });
      if (j.status !== 'pronto' || !j.resultado_url) return res.status(400).json({ error: 'Vídeo ainda não está pronto' });
      let salvo = {};
      try { salvo = await salvarVideoNoBanco(j.resultado_url, j.user_id, SUPABASE_URL, KEY()); } catch (e) { salvo = { error: e.message }; }
      if (salvo && salvo.url) {
        await sbPatch(`video_jobs?id=eq.${job_id}`, { salvo_url: salvo.url, salvo_path: salvo.path });
        return res.status(200).json({ ok: true, salvo_url: salvo.url });
      }
      return res.status(200).json({ ok: false, erro: (salvo && salvo.error) || 'não foi possível salvar', resultado_url: j.resultado_url });
    }

    // ── DIAGNÓSTICO: mostra o estado real do vídeo no Shotstack (debug) ──
    if (action === 'video_diagnostico') {
      const uid = requester.id;
      const jobs = await sbGet(`video_jobs?user_id=eq.${uid}&order=created_at.desc&limit=1&select=*`);
      const j = Array.isArray(jobs) && jobs[0];
      if (!j) return res.status(200).json({ ok: true, msg: 'Nenhum vídeo encontrado.' });
      const out = { job: { id: j.id, status: j.status, render_id: j.render_id, erro: j.erro, criado: j.created_at } };
      const key = process.env.ZAPCAP_API_KEY;
      try {
        if (j.render_id && j.render_id.startsWith('zap:')) {
          const partes = j.render_id.split(':'); // ['zap', videoId, taskId]
          const videoId = partes[1], taskId = partes[2];
          const rr = await fetch(`https://api.zapcap.ai/videos/${videoId}/task/${taskId}`, { headers: { 'x-api-key': key } });
          const rd = await rr.json();
          out.http_status = rr.status;
          out.zapcap = { status: rd && rd.status, downloadUrl: rd && rd.downloadUrl, error: rd && (rd.error || rd.detail) };
        }
      } catch (e) { out.erro_diag = e.message; }
      return res.status(200).json({ ok: true, diagnostico: out });
    }

    // ── VÍDEO BAIXADO: marca como baixado e apaga o vídeo CRU (libera espaço) ──
    if (action === 'video_baixado') {
      const uid = requester.id;
      const { job_id } = req.body;
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      const [j] = await sbGet(`video_jobs?id=eq.${job_id}&select=user_id,origem_url,cru_apagado`);
      if (!j || (j.user_id !== uid && !isAdmin)) return res.status(403).json({ error: 'Sem acesso' });
      // apaga o vídeo cru do Storage (se ainda não apagou)
      if (!j.cru_apagado && j.origem_url) {
        try {
          // extrai o path do bucket videos-crus a partir da URL pública
          const m = j.origem_url.match(/videos-crus\/(.+)$/);
          if (m && m[1]) {
            await fetch(`${SUPABASE_URL}/storage/v1/object/videos-crus/${m[1]}`, { method: 'DELETE', headers: H() }).catch(() => {});
          }
        } catch (e) { /* ignora */ }
      }
      await sbPatch(`video_jobs?id=eq.${job_id}`, { baixado: true, cru_apagado: true });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação desconhecida' });
  } catch (err) {
    console.error('admin-users error:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
