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
  if (!r.ok) throw new Error('Erro ao inserir');
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
        const meus = await sbGet(`clientes?supervisor_id=eq.${requester.id}&select=id`);
        const limite = (me && me.limite_contas) || 0;
        if (limite && meus.length >= limite) {
          return res.status(400).json({ error: `Limite de ${limite} contas atingido` });
        }
      }
      // Cria no Auth (e-mail já confirmado — conta criada pelo gestor)
      const novo = await authAdmin('users', 'POST', {
        email, password: senha, email_confirm: true,
        user_metadata: { nome, plano: plano || 'plus' },
      });
      // Linha em clientes
      const row = {
        id: novo.id, email, nome, role: novoRole,
        plano: plano || (novoRole === 'supervisor' ? null : 'plus'),
        status: 'ativo', bloqueado: false,
        telefone: telefone || null, cpf: cpf || null, endereco: endereco || null,
        cortesia_ate: cortesiaDate(cortesia),
        supervisor_id: novoRole === 'usuario' ? requester.id : null,
        limite_contas: novoRole === 'supervisor' ? (limite_contas || 10) : 0,
      };
      try { await sbInsert('clientes', row); }
      catch (e) { await sbPatch(`clientes?id=eq.${novo.id}`, row); } // trigger pode ter criado a linha
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

    return res.status(400).json({ error: 'Ação desconhecida' });
  } catch (err) {
    console.error('admin-users error:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
