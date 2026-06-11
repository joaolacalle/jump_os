/* JUMP OS — Core compartilhado das dashboards */
window.JUMP=(function(){
  const SUPABASE_URL='https://fcdjzubdxikpvcqvalnt.supabase.co';
  const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZGp6dWJkeGlrcHZjcXZhbG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzA3OTYsImV4cCI6MjA5NTk0Njc5Nn0.w1cwt00JonkItRYu_hpAUWJ-p4mhuBeLmULqzX2zUHk';
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

  /* Guard: exige login; roles = array opcional ['admin','supervisor'] */
  async function guard(roles){
    const{data}=await sb.auth.getSession();
    if(!data||!data.session){location.href='login.html';throw new Error('no-session')}
    const user=data.session.user;
    let cliente={};
    try{
      const{data:c}=await sb.from('clientes').select('*').eq('id',user.id).single();
      if(c)cliente=c;
    }catch(e){}
    const role=cliente.role||'usuario';
    if(roles&&!roles.includes(role)){location.href='dashboard-usuario.html';throw new Error('no-role')}
    if(cliente.bloqueado){await sb.auth.signOut();location.href='login.html';throw new Error('blocked')}
    return{user,cliente,role,token:data.session.access_token};
  }

  async function logout(){await sb.auth.signOut();location.href='home.html'}

  function toast(msg,type){
    let t=document.getElementById('jump-toast');
    if(!t){t=document.createElement('div');t.id='jump-toast';t.className='toast';document.body.appendChild(t)}
    t.textContent=msg;t.className='toast show'+(type==='err'?' err':'');
    clearTimeout(t._tm);t._tm=setTimeout(()=>t.className='toast',3600);
  }

  /* Chamada autenticada ao backend de gestão */
  async function api(action,payload,token){
    const r=await fetch('/api/admin-users',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({action,...payload})
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erro na operação');
    return d;
  }

  function fmtNum(n){
    if(n===null||n===undefined)return'0';
    n=Number(n)||0;
    if(n>=1e6)return(n/1e6).toFixed(1)+'M';
    if(n>=1e3)return(n/1e3).toFixed(1)+'k';
    return String(n);
  }
  function fmtBRL(n){return'R$'+(Number(n)||0).toFixed(2).replace('.',',')}
  function esc(s){return String(s||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}

  function setUser(cliente,user){
    const email=user.email;
    const nome=(user.user_metadata&&user.user_metadata.nome)||cliente.nome||email.split('@')[0];
    const av=document.getElementById('sb-avatar');if(av)av.textContent=nome.charAt(0).toUpperCase();
    const em=document.getElementById('sb-email');if(em)em.textContent=email;
    const hh=document.getElementById('hd-hello');if(hh)hh.textContent='Bem-vindo, '+nome.split(' ')[0];
    return nome;
  }

  return{sb,guard,logout,toast,api,fmtNum,fmtBRL,esc,setUser};
})();
