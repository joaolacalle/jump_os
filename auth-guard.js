// ═══════════════════════════════════════════════════
// JUMP OS — Auth Guard + Supabase Client
// Incluir em TODAS as páginas protegidas
// ═══════════════════════════════════════════════════

const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZGp6dWJkeGlrcHZjcXZhbG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzA3OTYsImV4cCI6MjA5NTk0Njc5Nn0.w1cwt00JonkItRYu_hpAUWJ-p4mhuBeLmULqzX2zUHk';
const ADMIN_EMAIL  = 'jvittor@icloud.com';

// Inicializar cliente Supabase
const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Verificar sessão ativa — redireciona para login se não logado
async function requireAuth(redirectTo = 'login.html') {
  const { data: { session } } = await _supa.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

// Verificar se é admin
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;
  if (session.user.email !== ADMIN_EMAIL) {
    window.location.href = 'dashboard-usuario.html';
    return null;
  }
  return session;
}

// Buscar dados do cliente logado
async function getClienteAtual() {
  const { data: { session } } = await _supa.auth.getSession();
  if (!session) return null;
  const { data } = await _supa.from('clientes').select('*').eq('user_id', session.user.id).single();
  return data;
}

// Preencher nome do usuário nas páginas
async function fillUserInfo() {
  const { data: { session } } = await _supa.auth.getSession();
  if (!session) return;
  const cliente = await getClienteAtual();
  const nome = cliente?.nome || session.user.email;
  const initials = nome.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('user-name')?.textContent !== undefined &&
    (document.getElementById('user-name').textContent = nome.split(' ')[0]);
  document.getElementById('user-av')?.textContent !== undefined &&
    (document.getElementById('user-av').textContent = initials);
  if (cliente?.plano) {
    const badge = document.getElementById('plan-badge-top');
    if (badge) badge.textContent = 'Plano ' + (cliente.plano.charAt(0).toUpperCase() + cliente.plano.slice(1));
  }
}

// Logout
async function doLogout() {
  await _supa.auth.signOut();
  window.location.href = 'login.html';
}
