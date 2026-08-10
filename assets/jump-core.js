/* JUMP OS — Core compartilhado das dashboards */
/* VERSAO: bump obrigatório a cada alteração deste arquivo. O mesmo número vai no ?v= das páginas,
   então o navegador é forçado a baixar o build novo (fim do "código certo, runtime antigo"). */
window.JUMP_VERSAO='5';
window.JUMP=(function(){
  /* ══ TEMA ══ */
  function hexRgb(h){h=h.replace('#','');return parseInt(h.substr(0,2),16)+','+parseInt(h.substr(2,2),16)+','+parseInt(h.substr(4,2),16)}
  function applyTheme(t){
    t=t||{};const r=document.documentElement.style;
    if(t.c1){const rgb=hexRgb(t.c1);r.setProperty('--g',t.c1);r.setProperty('--g2',t.c1);r.setProperty('--g-rgb',rgb)}
    if(t.c2)r.setProperty('--a2',t.c2);
    // c3 (cor terciária) controla também as FONTES menores/cinzas do sistema:
    // --t2 (texto de apoio) e --t3 (legendas/detalhes) derivam de c3 com transparência,
    // preservando a hierarquia visual em qualquer cor de marca.
    if(t.c3){
      r.setProperty('--a3',t.c3);
      const rgb3=hexRgb(t.c3);
      r.setProperty('--t2','rgba('+rgb3+',.68)');
      r.setProperty('--t3','rgba('+rgb3+',.45)');
    }else{r.removeProperty('--a3');r.removeProperty('--t2');r.removeProperty('--t3');}
    // t1 = cor do texto principal (títulos e corpo)
    if(t.t1){r.setProperty('--t1',t.t1);}else{r.removeProperty('--t1');}
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

    // ═══ GATE DE ACESSO ═══════════════════════════════════════════════════════
    // REGRA DE NEGÓCIO: o cartão é pedido DEPOIS do check-in, não na porta.
    // O check-in (Identidade) é barato (só texto) e é onde a pessoa vê valor —
    // o DNA da marca dela mapeado. Pedir o cartão ali converte muito melhor do que
    // pedir para quem ainda não viu nada. Os outros agentes dependem do OS_DATA,
    // então quem não fez o check-in não consegue produzir nada mesmo: o funil se
    // limita sozinho, sem precisar de trava extra.
    //
    // 🔴 BUGS CORRIGIDOS AQUI:
    //  (1) antes testava `!cliente.cortesia_ate` — só a EXISTÊNCIA do campo. Trial
    //      vencido continuava entrando para sempre (o backend já comparava a data;
    //      os dois discordavam).
    //  (2) `status` NUNCA era consultado: quem cancelava mantinha o assinatura_id e
    //      seguia usando o sistema de graça, indefinidamente. Receita vazando calada.
    const _q=new URLSearchParams(location.search);
    const _pagOk=_q.get('pagamento')==='sucesso';
    if(role==='usuario' && !_q.get('ver') && !_pagOk && !cliente.supervisor_id){
      const agora=Date.now();
      const trialOk=!!(cliente.cortesia_ate && new Date(cliente.cortesia_ate).getTime()>agora);
      const statusRuim=['cancelado','suspenso','inadimplente'].includes(String(cliente.status||'').toLowerCase());
      const assinaturaOk=!!cliente.assinatura_id && !statusRuim;
      const checkinFeito=!!((cliente.onboarding||{}).checkin);
      // PERFORMANCE: só consulta o modo de acesso para quem SERIA barrado (minoria).
      // Rodar em toda página, para todo usuário, seria uma ida à rede desnecessária.
      let listaEspera=false;
      const seriaBarrado = !assinaturaOk && !trialOk && checkinFeito;
      if(seriaBarrado){
        // Em LISTA DE ESPERA ninguém é cobrado nem expulso: não estamos vendendo, então
        // seria injusto barrar quem entrou cedo. O acesso se estende sozinho.
        try{
          const cache=sessionStorage.getItem('jump_modo_acesso');
          if(cache){ listaEspera=cache==='lista_espera'; }
          else{
            const st=await fetch('/api/admin-users',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({action:'status_acesso'})}).then(r=>r.json());
            listaEspera=st&&st.modo==='lista_espera';
            try{sessionStorage.setItem('jump_modo_acesso',listaEspera?'lista_espera':'aberto')}catch(e){}
          }
        }catch(e){}
      }
      window.JUMP._acesso={trialOk,assinaturaOk,checkinFeito,listaEspera,statusRuim};
      if(seriaBarrado && !listaEspera){
        const motivo=statusRuim?'assinatura':(cliente.cortesia_ate?'trial':'novo');
        location.href='checkout.html?plano='+((cliente.plano)||'basico')+'&motivo='+motivo;
        throw new Error('need-checkout');
      }
    }

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

  /* AUTO-DISPATCH: criar tarefa e disparar execução são o MESMO ato. Qualquer tela que insere
     uma ordem chama isto — o worker do servidor produz na hora, sem PLAY e sem página aberta.
     Se falhar, o cron pega a mesma ordem na próxima rodada (fallback, nunca perda). */
  async function dispararFila(){
    try{ const r=await authFetch('/api/cron?job=produzir_meu',{method:'POST'}); return await r.json().catch(()=>null); }
    catch(e){ return null; }
  }

  /* Token sempre fresco: o SDK renova sozinho, então nunca reusar a "foto" velha do login. */
  async function freshToken(){
    try{ const{data}=await sb.auth.getSession(); if(data&&data.session&&data.session.access_token) return data.session.access_token; }catch(e){}
    return null;
  }
  /* Fetch autenticado: pega o token atual e, em 401, renova a sessão e repete 1x — silencioso (o usuário não vê "sessão inválida"). */
  async function authFetch(url,opts){
    opts=opts||{};
    let tk=await freshToken();
    const call=(t)=>fetch(url,Object.assign({},opts,{headers:Object.assign({},opts.headers||{},t?{'Authorization':'Bearer '+t}:{})}));
    let r=await call(tk);
    if(r.status===401){
      try{ const rr=await sb.auth.refreshSession(); if(rr&&rr.data&&rr.data.session&&rr.data.session.access_token) tk=rr.data.session.access_token; }catch(e){}
      r=await call(tk);
    }
    return r;
  }
  /* Chamada autenticada ao backend de gestão */
  async function api(action,payload,token){
    const r=await authFetch('/api/admin-users',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,...payload})
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erro na operação');
    return d;
  }
  // baixa um arquivo de verdade (força download, não abre em nova aba)
  async function baixarArquivo(url,nome){
    try{
      const r=await fetch(url);
      const blob=await r.blob();
      const a=document.createElement('a');
      const objUrl=URL.createObjectURL(blob);
      a.href=objUrl;a.download=nome||('video_'+Date.now()+'.mp4');
      document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(objUrl);a.remove();},1000);
      return true;
    }catch(e){
      // fallback: tenta link direto com download
      try{const a=document.createElement('a');a.href=url;a.download=nome||'video.mp4';a.click();}catch(_){}
      return false;
    }
  }
  // versão que nunca lança erro (p/ polling em background, não assusta o usuário)
  async function apiSilencioso(action,payload,token){
    try{
      const r=await authFetch('/api/admin-users',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,...payload})
      });
      if(!r.ok)return null;
      return await r.json();
    }catch(e){return null;}
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
    const L=[['dashboard-usuario.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>','Painel','painel'],['agentes.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg>','Meus agentes','agentes'],['ordens.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><path d="M8 12h8M8 16h6"/></svg>','Tarefas de Serviço','ordens'],
      ['calendario.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>','Calendário','calendario'],['aprovar.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>','Aprovações','aprovar'],
      ['historico.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>','Histórico','historico'],['upload.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>','Meus arquivos','upload'],
      ['suporte.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>','Suporte JUMP','suporte'],['configuracoes.html','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>','Configurações','config']];
    const aside=document.createElement('aside');aside.className='sidebar';
    aside.innerHTML=`<div class="sb-logo"><img src="assets/logo.png" alt="JUMP OS"></div>
      <nav class="sb-nav">${L.map(l=>`<a href="${verLink(l[0])}" class="sb-link${l[3]===active?' a':''}"><span class="sb-ico">${l[1]}</span>${l[2]}</a>`).join('')}</nav>
      <div class="sb-foot"><div class="sb-user"><div class="sb-avatar" id="sb-avatar">·</div><div class="sb-email" id="sb-email">...</div></div>
      <button class="sb-out" onclick="JUMP.logout()">→ Sair da conta</button></div>`;
    const app=document.querySelector('.app');
    if(app)app.insertBefore(aside,app.firstChild);
    const mt=document.createElement('div');mt.className='mob-top';
    mt.innerHTML=`<button class="mob-burger" aria-label="Menu" onclick="JUMP.toggleSidebar(true)">☰</button><img src="assets/logo.png" alt="JUMP OS"><button class="mob-out" onclick="JUMP.logout()">Sair</button>`;
    document.body.insertBefore(mt,document.body.firstChild);
    // overlay p/ fechar a sidebar ao tocar fora (mobile)
    const ov=document.createElement('div');ov.className='sb-overlay';ov.onclick=()=>JUMP.toggleSidebar(false);
    document.body.appendChild(ov);
  }
  function toggleSidebar(abrir){
    const sb=document.querySelector('.sidebar');const ov=document.querySelector('.sb-overlay');
    if(!sb)return;
    const mostrar = abrir===undefined ? !sb.classList.contains('open') : abrir;
    sb.classList.toggle('open',mostrar);
    if(ov)ov.classList.toggle('show',mostrar);
    document.body.style.overflow=mostrar?'hidden':'';
  }


  // ══ CONTRATO ÚNICO DE GERAÇÃO DE ARTE ══════════════════════════════════════════
  // Existiam 4 portas para gerar arte com 4 contratos DIFERENTES:
  //   calendario.html  → mandava headline/copy/oferta/formato/pilar  ✅
  //   agentes.html     → mandava tudo                                 ✅
  //   aprovar.html     → amassava tudo numa sopa de texto            ❌
  //   dashboard        → idem                                         ❌
  // A sopa era assim: `Instagram feed post. Headline: "...". Support copy: "...".
  // Agency-grade, layered depth, top label, dominant headline...` — mandada como
  // `prompt`, SEM nenhum campo estruturado. No servidor virava:
  //     oArte = { tema: <a sopa>, headline: undefined, copy: undefined }
  // e o Diretor recebia "NO HEADLINE WAS PROVIDED: write the headline yourself".
  // A headline REAL, escrita pela Estratégia, nunca saía da página. O Diretor
  // inventava uma a partir da sopa — origem do "POR QUE AGENTE DE IA VAI MUDAR".
  // Aquele "Agency-grade, layered depth..." ainda era um mini-engine de ANTES do
  // Engine 6.0, brigando com o Engine 6.0 dentro do mesmo prompt.
  // 4ª vez do mesmo padrão (conteudos/coluna, ordem/detalhe, lista/cardápio, headline/sopa):
  // dado estruturado achatado em texto livre, falha silenciosa.
  // A partir daqui: UMA porta, UM contrato. Quem gerar arte, gera por aqui.
  function payloadDoConteudo(c, opts){
    c = c || {}; opts = opts || {};
    const meta = c.meta || {};
    const formato = String(c.formato || 'feed');
    const ehReel = /reel|v[íi]deo|video/i.test(formato);
    return {
      // `prompt` = o TEMA cru. Nunca uma frase montada, nunca jargão de design:
      // o Engine 6.0 + o Diretor de Arte são donos da direção de arte, não a página.
      prompt: c.tema || meta.headline || '',
      headline: meta.headline || c.tema || '',
      subheadline: meta.subheadline || '',   // P2: a segunda parte do texto (o porquê)
      prova: meta.prova || '',               // P2: dado real que sustenta a promessa
      cta_arte: meta.cta_arte || '',         // P2: a chamada que vai NA arte
      copy: c.copy || '',
      oferta: meta.oferta || '',
      formato: formato,
      pilar: c.pilar || '',
      tipo: c.tipo_visual || 'conceitual',
      tamanho: opts.tamanho || (ehReel ? '9:16' : '4:5'),
      slide: opts.slide || 1,
      total: opts.total || 1,   // quantidade de slides: depende do schema real da `conteudos`
      conteudo_id: c.id || null,
      origem: opts.origem || 'expressa',   // 'lote' respeita a reserva de cota 80/20
      ver_id: opts.ver_id || null,
      variacao: opts.variacao || 0,
      ajuste: opts.ajuste || '',
      reload: !!opts.reload,
    };
  }
  // Badge do tipo de peça — usado no calendário e no Aprovar (mesma verdade nos dois).
  // Só olha `formato`, que existe de verdade. NÃO inventa coluna de contagem de slides:
  // o schema da `conteudos` precisa ser perguntado ao banco antes (regra do João).
  // Slides de um conteúdo. meta.slides é a fonte; midia_url é a capa (compatibilidade).
  function slidesDe(c){
    c = c || {}; const m = c.meta || {};
    const arr = Array.isArray(m.slides) ? m.slides.filter(x => x && x.url) : [];
    if (arr.length) return arr.slice().sort((a,b)=>Number(a.n)-Number(b.n)).map(x=>x.url);
    return c.midia_url ? [c.midia_url] : [];
  }
  function totalSlides(c){
    const m = (c || {}).meta || {};
    return Math.max(Number(m.total_slides) || 0, slidesDe(c).length, 1);
  }
  function tipoPeca(c){
    const f = String((c || {}).formato || 'feed').toLowerCase();
    if (f.indexOf('carrossel') >= 0 || f.indexOf('carousel') >= 0 || totalSlides(c) > 1) return { id:'carrossel', label:'Carrossel', ico:'▤' };
    if (f.indexOf('reel') >= 0 || f.indexOf('video') >= 0 || f.indexOf('vídeo') >= 0) return { id:'reels', label:'Estático de reels', ico:'▶' };
    return { id:'feed', label:'Feed', ico:'▣' };
  }

  function diag(){const d={versao:window.JUMP_VERSAO,dispararFila:typeof dispararFila,authFetch:typeof authFetch,chaves:Object.keys(window.JUMP||{}).length};console.log('[JUMP] diagnóstico',d);return d;}
  return{VERSAO:window.JUMP_VERSAO,diag,sb,guard,logout,toast,api,apiSilencioso,freshToken,authFetch,dispararFila,baixarArquivo,fmtNum,fmtBRL,esc,setUser,applyTheme,sidebar,verLink,toggleSidebar,payloadDoConteudo,tipoPeca,slidesDe,totalSlides};
})();
