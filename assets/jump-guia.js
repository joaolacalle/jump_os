/* ═══ GUIA DO SISTEMA (jump-guia.js) — boas-vindas + dicas de primeira vez ═══
   Um manual prático dentro do produto. Cada dica aparece UMA vez por usuário. */
(function(){
  const K=u=>'jump_guia_'+(u||'x');
  let VISTOS={},UID='x';
  function carregar(){try{VISTOS=JSON.parse(localStorage.getItem(K(UID))||'{}')}catch(e){VISTOS={}}}
  function salvar(){try{localStorage.setItem(K(UID),JSON.stringify(VISTOS))}catch(e){}}
  function css(){
    if(document.getElementById('guia-css'))return;
    const st=document.createElement('style');st.id='guia-css';
    st.textContent=`
    .gv-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;animation:gv-fade .3s}
    @keyframes gv-fade{from{opacity:0}to{opacity:1}}
    @keyframes gv-up{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
    .gv-card{background:var(--card,#141312);border:1px solid var(--bd,#2a2827);border-radius:18px;max-width:440px;width:100%;padding:24px;position:relative;animation:gv-up .4s cubic-bezier(.22,1,.36,1)}
    .gv-x{position:absolute;top:12px;right:14px;background:none;border:none;color:var(--t3,#8a8785);font-size:18px;cursor:pointer}
    .gv-ico{font-size:34px;margin-bottom:10px}
    .gv-t{font-family:var(--D,var(--B,sans-serif));font-size:21px;color:var(--t1,#f5f3f0);margin-bottom:7px;line-height:1.2}
    .gv-d{font-size:13.5px;color:var(--t2,#b8b5b2);line-height:1.6}
    .gv-steps{margin:16px 0;display:flex;flex-direction:column;gap:10px}
    .gv-step{display:flex;gap:11px;align-items:flex-start;background:rgba(255,255,255,.03);border:1px solid var(--bd,#2a2827);border-radius:11px;padding:11px 12px}
    .gv-n{width:22px;height:22px;border-radius:7px;background:linear-gradient(145deg,rgba(168,85,247,.35),rgba(168,85,247,.12));display:flex;align-items:center;justify-content:center;font-family:var(--M,monospace);font-size:10px;color:#C084FC;flex-shrink:0;font-weight:700}
    .gv-st{font-size:12.5px;color:var(--t1,#f5f3f0);font-weight:700}
    .gv-sd{font-size:11.5px;color:var(--t3,#8a8785);line-height:1.45;margin-top:2px}
    .gv-dots{display:flex;gap:5px;justify-content:center;margin:14px 0 4px}
    .gv-dot{width:6px;height:6px;border-radius:50%;background:var(--bd,#2a2827);transition:.3s}
    .gv-dot.on{background:var(--g,#34d399);width:18px;border-radius:3px}
    .gv-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
    .gv-tip{position:fixed;bottom:20px;right:20px;max-width:330px;background:var(--card,#141312);border:1px solid rgba(168,85,247,.4);border-left:3px solid #C084FC;border-radius:13px;padding:14px 16px;z-index:8500;box-shadow:0 18px 45px -12px rgba(0,0,0,.75);animation:gv-up .45s cubic-bezier(.22,1,.36,1)}
    .gv-tip-t{font-family:var(--M,monospace);font-size:9px;color:#C084FC;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px}
    .gv-tip-d{font-size:12.5px;color:var(--t2,#b8b5b2);line-height:1.5}
    .gv-tip-x{position:absolute;top:9px;right:11px;background:none;border:none;color:var(--t3,#8a8785);font-size:14px;cursor:pointer}
    @media(max-width:560px){.gv-tip{left:12px;right:12px;bottom:12px;max-width:none}}
    @media(prefers-reduced-motion:reduce){.gv-ov,.gv-card,.gv-tip{animation:none}}`;
    document.head.appendChild(st);
  }
  const PASSOS=[
    {ico:'🚀',t:'Bem-vindo ao JUMP OS',d:'Sua agência de marketing com IA. Em poucos minutos você tem um mês de conteúdo planejado, criado e publicado — sem sair daqui.',steps:[
      {n:'1',t:'Complete seu OS_DATA',d:'Os agentes de Identidade, Mercado e Diagnóstico aprendem sobre o seu negócio. É a base de tudo.'},
      {n:'2',t:'Conecte seu Instagram',d:'Sem a conexão, o sistema não mede resultados nem publica por você.'}]},
    {ico:'📋',t:'Como o trabalho acontece',d:'Os agentes conversam entre si. Você aprova — eles executam.',steps:[
      {n:'1',t:'Estratégia monta o mês',d:'Peça o plano ao Agente de Estratégia. Ele desenha o calendário inteiro.'},
      {n:'2',t:'Você aprova em Tarefas',d:'Nada entra no calendário sem o seu OK. Toda ordem entre agentes passa por você.'},
      {n:'3',t:'Designer cria as artes',d:'Ele gera as imagens da semana, em sequência. Você acompanha o progresso (ex: 3/5).'},
      {n:'4',t:'Publicação posta',d:'Só o que está completo e aprovado vai ao ar, na data agendada.'}]},
    {ico:'🎬',t:'O que é seu, o que é nosso',d:'A IA cria as artes. Os vídeos são seus — e o Agente de Vídeo te ensina a gravar e edita pra você.',steps:[
      {n:'✓',t:'Imagens: automático',d:'Feed, carrossel e story saem prontos do Designer.'},
      {n:'📹',t:'Reels: você grava',d:'No calendário, o post pede "envie seu vídeo". O Agente de Vídeo cuida do resto.'}]}
  ];
  let iP=0;
  function fechar(){const o=document.querySelector('.gv-ov');if(o)o.remove()}
  function render(){
    const p=PASSOS[iP];
    let ov=document.querySelector('.gv-ov');
    if(!ov){ov=document.createElement('div');ov.className='gv-ov';document.body.appendChild(ov)}
    ov.innerHTML=`<div class="gv-card">
      <button class="gv-x" onclick="JUMPGUIA.fechar()">✕</button>
      <div class="gv-ico">${p.ico}</div>
      <div class="gv-t">${p.t}</div>
      <div class="gv-d">${p.d}</div>
      <div class="gv-steps">${p.steps.map(s=>`<div class="gv-step"><div class="gv-n">${s.n}</div><div><div class="gv-st">${s.t}</div><div class="gv-sd">${s.d}</div></div></div>`).join('')}</div>
      <div class="gv-dots">${PASSOS.map((_,i)=>`<div class="gv-dot ${i===iP?'on':''}"></div>`).join('')}</div>
      <div class="gv-foot">
        ${iP>0?'<button class="btn btn-o btn-sm" onclick="JUMPGUIA.voltar()">← Voltar</button>':'<button class="btn btn-o btn-sm" onclick="JUMPGUIA.fechar()">Pular</button>'}
        <button class="btn btn-g btn-sm" onclick="JUMPGUIA.proximo()">${iP===PASSOS.length-1?'Começar 🚀':'Próximo →'}</button>
      </div></div>`;
  }
  const API={
    init(uid){UID=uid||'x';carregar();css()},
    boasVindas(){ if(VISTOS.boas_vindas)return; VISTOS.boas_vindas=true;salvar(); iP=0;render(); },
    fechar(){fechar()},
    voltar(){if(iP>0){iP--;render()}},
    proximo(){ if(iP<PASSOS.length-1){iP++;render()} else fechar(); },
    reabrir(){iP=0;render()},
    /* Dica contextual: aparece UMA vez por processo. Ex: JUMPGUIA.dica('estrategia_criada','...') */
    dica(chave,texto,titulo){
      if(VISTOS['dica_'+chave])return;
      VISTOS['dica_'+chave]=true;salvar();css();
      const d=document.createElement('div');d.className='gv-tip';
      d.innerHTML=`<button class="gv-tip-x" onclick="this.parentElement.remove()">✕</button>
        <div class="gv-tip-t">💡 ${titulo||'Dica'}</div><div class="gv-tip-d">${texto}</div>`;
      document.body.appendChild(d);
      setTimeout(()=>{if(d.parentElement)d.remove()},14000);
    }
  };
  window.JUMPGUIA=API;
})();
