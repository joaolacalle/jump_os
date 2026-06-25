/* JUMP OS — Core compartilhado das dashboards */
window.JUMP=(function(){
  /* ══ TEMA ══ */
  function hexRgb(h){h=h.replace('#','');return parseInt(h.substr(0,2),16)+','+parseInt(h.substr(2,2),16)+','+parseInt(h.substr(4,2),16)}
  function applyTheme(t){
    t=t||{};const r=document.documentElement.style;
    if(t.c1){const rgb=hexRgb(t.c1);r.setProperty('--g',t.c1);r.setProperty('--g2',t.c1);r.setProperty('--g-rgb',rgb)}
    if(t.c2)r.setProperty('--a2',t.c2);
    if(t.c3)r.setProperty('--a3',t.c3);
    document.documentElement.setAttribute('data-theme',t.bg==='claro'?'light':'dark');
    // c4 = fundo da área de conteúdo (--ch, aplicado no .main); c5 = fundo dos cards (--card)
    if(t.c4){r.setProperty('--ch',t.c4);}else{r.removeProperty('--ch');}
    if(t.c5){r.setProperty('--card',t.c5);}else{r.removeProperty('--card');}
    try{localStorage.setItem('jump_tema',JSON.stringify(t))}catch(e){}
  }
  try{const t=JSON.parse(localStorage.getItem('jump_tema')||'null');if(t)applyTheme(t)}catch(e){}

  const SUPABASE_URL='https://fcdjzubdxikpvcqvalnt.supabase.co';
  const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZGp6dWJkeGlrcHZjcXZhbG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzA3OTYsImV4cCI6MjA5NTk0Njc5Nn0.w1cwt00JonkItRYu_hpAUWJ-p4mhuBeLmULqzX2zUHk';
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{ autoRefreshToken:true, persistSession:true, detectSessionInUrl:true }
  });
  // OPÇÃO C: timer proativo — renova o token a cada 45 min (antes de expirar ~1h)
  setInterval(async ()=>{
    try{ const{data}=await sb.auth.getSession(); if(data&&data.session){ await sb.auth.refreshSession(); } }catch(e){}
  }, 45*60*1000);

  /* Guard: exige login; roles = array opcional ['admin','supervisor'] */
  async function guard(roles){
    let{data}=await sb.auth.getSession();
    // tenta renovar a sessão antes de desistir (evita 'sessão inválida' por token expirado)
    if(!data||!data.session){
      try{ const r=await sb.auth.refreshSession(); if(r&&r.data&&r.data.session){ data=r.data; } }catch(e){}
    }
    if(!data||!data.session){location.href='login.html';throw new Error('no-session')}
    const user=data.session.user;
    let cliente={};
    try{
      // sem .single() (quebra se houver 0/2+ linhas) — pega a primeira
      const{data:cs}=await sb.from('clientes').select('*').eq('id',user.id).limit(1);
      if(cs&&cs.length)cliente=cs[0];
    }catch(e){console.error('guard clientes:',e)}
    const role=cliente.role||'usuario';
    if(roles&&!roles.includes(role)){
      // sem permissão para esta página — manda para o painel do papel real
      const destino=role==='admin'?'dashboard-admin.html':role==='supervisor'?'dashboard-supervisor.html':'dashboard-usuario.html';
      if((location.pathname.split('/').pop()||'')!==destino)location.href=destino;
      throw new Error('no-role');
    }
    if(cliente.bloqueado){await sb.auth.signOut();location.href='login.html';throw new Error('blocked')}

    // IMPERSONAÇÃO GLOBAL: supervisor/admin visualizando outra conta via ?ver=ID
    let viewing=null, viewId=user.id, viewCliente=cliente;
    const verParam=new URLSearchParams(location.search).get('ver');
    if(verParam && (role==='supervisor'||role==='admin') && verParam!==user.id){
      try{
        const{data:alvo}=await sb.from('clientes').select('*').eq('id',verParam).limit(1);
        if(alvo&&alvo.length){
          viewing=alvo[0];viewId=viewing.id;viewCliente=viewing;
          window.JUMP._viewBanner=viewing; // sinaliza p/ mostrar banner
        }
      }catch(e){console.error('impersonate:',e)}
    }

    // tema: usa o da conta VISUALIZADA (personalização por usuário)
    if(viewCliente.tema)applyTheme(viewCliente.tema);
    else applyTheme({}); // reseta para padrão se a conta não tem tema próprio

    if(!viewing && (role==='supervisor'||role==='admin'))injectRoleBar(role);
    if(viewing)injectViewBanner(viewing,role);

    return{user,cliente,role,token:data.session.access_token,viewId,viewing,viewCliente};
  }

  async function logout(){await sb.auth.signOut();location.href='home.html'}

  /* Barra fixa de troca de perfil — ida E volta entre admin/supervisor/usuário */
  function injectRoleBar(role){
    if(document.querySelector('.role-bar'))return;
    const p=(location.pathname.split('/').pop()||'').split('?')[0];
    const items=[];
    // ADMIN: acumula papéis — pode acessar Admin, seu painel Supervisor e sua conta Usuário
    if(role==='admin'){
      items.push(['dashboard-admin.html','👑','Admin']);
      items.push(['dashboard-supervisor.html','🛡','Supervisor']);
      // Admin gerencia tudo pelos painéis Admin e Supervisor.
      // Para usar os agentes, cria seu próprio supervisor e contas supervisionadas.
    }
    // SUPERVISOR: NÃO tem barra de troca. Ele cai no painel supervisor e acessa
    // usuários pela tabela. O "voltar" fica no banner do painel do usuário.
    if(role!=='admin')return;
    const bar=document.createElement('div');bar.className='role-bar';
    bar.innerHTML=items.map(i=>`<a class="rb-link${p===i[0]?' on':''}" href="${i[0]}">${i[1]} ${i[2]}</a>`).join('');
    document.body.appendChild(bar);
  }

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
    // Em impersonação, prioriza os dados da conta VISUALIZADA (cliente), não do logado (user)
    const email=(cliente&&cliente.email)||user.email;
    const nome=(cliente&&cliente.nome)||(user.user_metadata&&user.user_metadata.nome)||(email?email.split('@')[0]:'Usuário');
    const av=document.getElementById('sb-avatar');if(av)av.textContent=nome.charAt(0).toUpperCase();
    const em=document.getElementById('sb-email');if(em)em.textContent=email;
    const hh=document.getElementById('hd-hello');if(hh)hh.textContent='Bem-vindo, '+nome.split(' ')[0];
    return nome;
  }

  function injectViewBanner(viewing,role){
    if(document.querySelector('.view-banner'))return;
    const back=role==='admin'?'dashboard-admin.html':'dashboard-supervisor.html';
    const b=document.createElement('div');b.className='view-banner';
    b.innerHTML=`<span>👁 Visualizando: <b>${(viewing.nome||viewing.email||'').toUpperCase()}</b></span><a href="${back}">← Voltar ao painel</a>`;
    document.body.appendChild(b);
  }
  // Propaga ?ver=ID em links internos quando em modo visualização
  function verLink(href){
    const v=new URLSearchParams(location.search).get('ver');
    if(!v)return href;
    return href+(href.includes('?')?'&':'?')+'ver='+v;
  }

  /* Sidebar padrão do usuário — páginas novas chamam JUMP.sidebar('id-ativo') */
  function sidebar(active){
    const L=[['dashboard-usuario.html','◈','Painel','painel'],['agentes.html','🤖','Meus agentes','agentes'],
      ['calendario.html','📅','Calendário','calendario'],['aprovar.html','✓','Aprovações','aprovar'],
      ['historico.html','🕘','Histórico','historico'],['upload.html','🖼','Meus arquivos','upload'],
      ['conectar-conta.html','🔗','Conexões','conexoes'],['suporte.html','💬','Suporte JUMP','suporte'],['configuracoes.html','⚙','Configurações','config']];
    const aside=document.createElement('aside');aside.className='sidebar';
    aside.innerHTML=`<div class="sb-logo"><img src="assets/logo.png" alt="JUMP OS"></div>
      <nav class="sb-nav">${L.map(l=>`<a href="${verLink(l[0])}" class="sb-link${l[3]===active?' a':''}"><span class="sb-ico">${l[1]}</span>${l[2]}</a>`).join('')}</nav>
      <div class="sb-foot"><div class="sb-user"><div class="sb-avatar" id="sb-avatar">·</div><div class="sb-email" id="sb-email">...</div></div>
      <button class="sb-out" onclick="JUMP.logout()">→ Sair da conta</button></div>`;
    const app=document.querySelector('.app');
    if(app)app.insertBefore(aside,app.firstChild);
    const mt=document.createElement('div');mt.className='mob-top';
    mt.innerHTML=`<img src="assets/logo.png" alt="JUMP OS"><button class="mob-out" onclick="JUMP.logout()">Sair</button>`;
    document.body.insertBefore(mt,document.body.firstChild);
  }

  return{sb,guard,logout,toast,api,fmtNum,fmtBRL,esc,setUser,applyTheme,sidebar,verLink};
})();
