// api/admin-users.js — Backend de gestão (supervisor/admin)
// ENV: SUPABASE_SERVICE_KEY (service role). Valida o JWT do solicitante e aplica escopo.
const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
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
      if (me.supervisor_id) destinos = [me.supervisor_id];
      else {
        const adms = await sbGet(`clientes?role=eq.admin&select=id`);
        destinos = (Array.isArray(adms) ? adms : []).map(a => a.id);
      }
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
    if (action === 'create_user' || action === 'create_supervisor') {
      const { nome, email, senha, plano, cortesia, telefone, cpf, endereco, limite_contas } = req.body;
      if (!nome || !email || !senha || senha.length < 6) {
        return res.status(400).json({ error: 'Dados incompletos (nome, e-mail, senha 6+)' });
      }
      const novoRole = action === 'create_supervisor' ? 'supervisor' : 'usuario';
      if (novoRole === 'supervisor' && !isAdmin) {
        return res.status(403).json({ error: 'Apenas admin cria supervisores' });
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
      // Cria no Auth (e-mail já confirmado — conta criada pelo gestor)
      const novo = await authAdmin('users', 'POST', {
        email, password: senha, email_confirm: true,
        user_metadata: { nome, plano: plano || 'plus' },
      });
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
        plano: plano || (novoRole === 'supervisor' ? null : 'plus'),
        status: 'ativo', bloqueado: false,
        telefone: telefone || null, cpf: cpf || null, endereco: endereco || null,
        cortesia_ate: cortesiaDate(cortesia),
        supervisor_id: novoRole === 'usuario' ? requester.id : null,
        limite_contas: novoRole === 'supervisor' ? (limite_contas || 10) : 0,
        limites: novoRole === 'usuario' ? { imagens: 100, videos: 20, trafego_sugestoes: 10, tokens: limTokens } : null,
      };
      // upsert: a trigger handle_new_user já pode ter criado a linha — fazemos merge
      await sbUpsert('clientes', row);
      await sbInsert('logs', { acao: `${role} criou ${novoRole}: ${email}`, user_id: requester.id }).catch(() => {});
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
      if (cortesia) patch.cortesia_ate = cortesiaDate(cortesia);
      if (email) { await authAdmin(`users/${user_id}`, 'PUT', { email }); patch.email = email; }
      await sbPatch(`clientes?id=eq.${user_id}`, patch);
      return res.status(200).json({ ok: true });
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
      await sbPatch(`clientes?id=eq.${user_id}`, { plano });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_limits') {
      const { user_id, limites } = req.body;
      await assertScope(user_id);
      await sbPatch(`clientes?id=eq.${user_id}`, { limites });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_cortesia') {
      const { user_id, cortesia } = req.body;
      await assertScope(user_id);
      await sbPatch(`clientes?id=eq.${user_id}`, { cortesia_ate: cortesiaDate(cortesia) });
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
      const [t] = await sbGet(`clientes?id=eq.${user_id}&select=role,email`);
      if (t && t.role === 'admin') return res.status(403).json({ error: 'Não é possível excluir um admin' });
      if (t && t.role === 'supervisor' && !isAdmin) return res.status(403).json({ error: 'Apenas admin exclui supervisores' });
      await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user_id}`, { method: 'DELETE', headers: H() });
      await fetch(`${SUPABASE_URL}/rest/v1/recados?user_id=eq.${user_id}`, { method: 'DELETE', headers: H() }).catch(() => {});
      await authAdmin(`users/${user_id}`, 'DELETE');
      await sbInsert('logs', { acao: `Conta excluída: ${(t && t.email) || user_id}`, user_id: requester.id }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_cotas') {
      if (!isAdmin) return res.status(403).json({ error: 'Apenas admin define cotas' });
      const { user_id, cotas } = req.body;
      await sbPatch(`clientes?id=eq.${user_id}`, { cotas });
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

    return res.status(400).json({ error: 'Ação desconhecida' });
  } catch (err) {
    console.error('admin-users error:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
