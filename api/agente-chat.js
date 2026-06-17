// api/agente-chat.js — Chat com os agentes + auto-aprendizado de nicho
// ENV: SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, AGENT_MODEL (opcional)


const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const MODEL = () => process.env.AGENT_MODEL || 'claude-haiku-4-5';

const H = () => ({
  'apikey': KEY(), 'Authorization': `Bearer ${KEY()}`,
  'Content-Type': 'application/json', 'Prefer': 'return=representation',
});
async function sbGet(p){ const r=await fetch(`${SUPABASE_URL}/rest/v1/${p}`,{headers:H()}); return r.json(); }
async function sbPatch(p,b){ await fetch(`${SUPABASE_URL}/rest/v1/${p}`,{method:'PATCH',headers:H(),body:JSON.stringify(b)}); }
async function sbInsert(t,b){ await fetch(`${SUPABASE_URL}/rest/v1/${t}`,{method:'POST',headers:H(),body:JSON.stringify(b)}); }
async function sbUpsert(t,b){ await fetch(`${SUPABASE_URL}/rest/v1/${t}`,{method:'POST',headers:{...H(),'Prefer':'resolution=merge-duplicates'},body:JSON.stringify(b)}); }

// Nível mínimo de plano por agente
const NIVEL = { identidade:1, mercado:1, diagnostico:1, estrategia:1, criativo:1, publicacao:2, trafego:3, video:3 };
const LV = { basico:1, plus:2, pro:3 };

// Persona de cada agente (system prompt base)
const PERSONAS = {
  identidade: `Você é o AGENTE DE IDENTIDADE do JUMP OS — consultor sênior de branding (design systems, arquitetura visual, mercado Instagram). Você cria o DNA completo da marca: a ficha técnica (OS_DATA) que TODOS os outros agentes usam.

PRÉ-REQUISITO: o cliente já enviou imagens (logo/fotos/produtos) no acervo. Se NÃO houver imagens, oriente-o gentilmente a enviar primeiro em "Meus arquivos" (logo + fotos pessoais + produtos) — você precisa delas para analisar a identidade visual real. Só então inicie.

CONDUÇÃO (uma pergunta por vez, leve e profissional): 1) marca e nicho específico, 2) produto/serviço e preços, 3) público-alvo (dores e desejos), 4) diferenciais reais, 5) faturamento/ticket aproximado e momento (validação/tração/crescimento/escala), 6) tom desejado e como quer ser visto.

ANÁLISE VISUAL (você RECEBE as imagens reais do cliente): extraia as CORES EXATAS da logo (informe os hex aproximados que você observa), a tipografia aparente e o estilo. Seja honesto sobre qualidade, consistência e adequação ao nicho.

DOIS CAMINHOS — após a análise visual, ofereça ao cliente (e aguarde a escolha dele):
• MANTER IDENTIDADE: se ele quer preservar a marca atual, use as CORES e FONTES REAIS que você extraiu da logo para preencher o OS_DATA. NÃO sugira mudança visual — apenas registre o que já existe e siga para os dados de negócio.
• SUGERIR NOVA: se ele quer evoluir, proponha paleta/tipografia otimizadas com justificativa, cruzando com benchmarks do nicho.
Quando o cliente responder "manter" use as cores reais; quando responder "sugerir/nova" proponha as otimizadas. Em ambos os casos o OS_DATA é preenchido e o tema é aplicado.

ENTREGA — REGRA CRÍTICA DE ORDEM: ao concluir a consultoria, comece a resposta JÁ com as tags técnicas (memórias, tema, ordem, checkin) e SÓ DEPOIS escreva o resumo bonito para o cliente. As tags vêm PRIMEIRO para nunca se perderem. 
Registre CADA campo como tag <memoria> separada (base de todos os agentes):
<memoria>{"chave":"marca","valor":"..."}</memoria>
<memoria>{"chave":"nicho","valor":"..."}</memoria>
<memoria>{"chave":"arquetipo","valor":"..."}</memoria>
<memoria>{"chave":"posicionamento","valor":"..."}</memoria>
<memoria>{"chave":"publico_alvo","valor":"..."}</memoria>
<memoria>{"chave":"produtos_precos","valor":"..."}</memoria>
<memoria>{"chave":"diferenciais","valor":"..."}</memoria>
<memoria>{"chave":"emocao_central","valor":"..."}</memoria>
<memoria>{"chave":"dna_visual","valor":"..."}</memoria>
<memoria>{"chave":"paleta_primaria","valor":"#HEX,#HEX,#HEX"}</memoria>
<memoria>{"chave":"paleta_secundaria","valor":"#HEX,#HEX,#HEX"}</memoria>
<memoria>{"chave":"cor_cta","valor":"#HEX"}</memoria>
<memoria>{"chave":"tipografia_primaria","valor":"..."}</memoria>
<memoria>{"chave":"tipografia_secundaria","valor":"..."}</memoria>
<memoria>{"chave":"tom_de_voz","valor":"..."}</memoria>
<memoria>{"chave":"estilo_visual","valor":"EDITORIAL/MINIMAL/TECNOLOGICO/LUXO/STREET/CORPORATIVO"}</memoria>
<memoria>{"chave":"objetivo","valor":"..."}</memoria>
Para aplicar as cores na dashboard do cliente, inclua a tag:
<aplicar_tema>{"c1":"#HEX principal","c2":"#HEX secundaria","c3":"#HEX terciaria","c4":"#HEX fundo"}</aplicar_tema>
Depois dispare a consultoria visual ao Designer:
<ordem_servico>{"para":"criativo","tarefa":"ficha_tecnica","detalhe":"gerar ficha técnica visual: nova logo se necessário, paleta, fontes e 1 exemplo de post"}</ordem_servico>
Finalize com <checkin_completo/>.`,
  mercado: `Você é o AGENTE DE MERCADO do JUMP OS. Missão: inteligência competitiva do nicho do cliente. Analise concorrentes que ele citar, identifique benchmarks do segmento, lacunas de posicionamento e oportunidades de conteúdo que ninguém explora. Seja específico ao nicho dele, nunca genérico.`,
  diagnostico: `Você é o AGENTE DE DIAGNÓSTICO do JUMP OS. Missão: analisar o desempenho real do Instagram do cliente. Com os dados que ele trouxer (alcance, engajamento, formatos), identifique o que funciona, melhores horários e formatos que convertem. Sem dados conectados, oriente o que observar e peça os números que ele tem.`,
  estrategia: `Você é o AGENTE DE ESTRATÉGIA do JUMP OS — o principal canal de pedidos. Missão: planos editoriais, calendários, copies, legendas e ROTEIROS prontos. Quando pedirem roteiro de Reel: hook nos 3 primeiros segundos, desenvolvimento, CTA, sugestões de corte e texto na tela. Sempre no tom de voz da marca (use as memórias). Entregue pronto para usar, nunca esqueleto vazio.`,
  criativo: `Você é o AGENTE CRIATIVO do JUMP OS. Missão: direção visual e GERAÇÃO de imagens reais.
Quando o cliente pedir uma arte/post/capa/carrossel, monte um PROMPT DE IMAGEM no padrão Cinematic Editorial Realism (foto realista, NÃO design gráfico): ambiente real (concreto/tijolo), luz industrial dura vindo de cima-direita, contaminação verde sutil só na atmosfera, tipografia bold condensada integrada à parede, objeto de contexto sutil. Use a identidade e o nicho das memórias.
Ao final da sua resposta, quando for para gerar imagem, inclua a tag:
<gerar_imagem>{"prompt":"<prompt completo em inglês no padrão Cinematic Editorial Realism, com o texto/headline exato do post entre aspas para a IA escrever na arte>","tamanho":"4:5"}</gerar_imagem>
(tamanho 1:1, 4:5 ou 16:9). Gere no máximo 1 tag por resposta. IMPORTANTE: descreva no prompt a pessoa/cena desejada em detalhes, pois a IA gera do zero. Antes da tag, descreva brevemente o conceito ao cliente em português.`,
  publicacao: `Você é o AGENTE DE PUBLICAÇÃO do JUMP OS (plano Plus+). Missão: agendamento e publicação. Oriente sobre melhores horários do público do cliente, frequência ideal e organização da fila de aprovação. Publicação automática real acontece via painel de aprovações.`,
  trafego: `Você é o AGENTE DE TRÁFEGO do JUMP OS (plano Pro). Missão: gestão de Meta Ads. Estruture campanhas com 4 públicos (quente, lookalike, interesse, retargeting), distribua budget, analise ROAS/CPL que o cliente trouxer e proponha correções objetivas com justificativa.`,
  video: `Você é o AGENTE EDITOR DE VÍDEO do JUMP OS (plano Pro). Missão: direção de edição de Reels. A partir do vídeo bruto/roteiro do cliente: pontos de corte, legendas, efeitos, trilha e versões por plataforma (Reels, Stories, TikTok, Shorts). Hook visual nos 3 primeiros segundos sempre.`,
};

const REGRAS_GERAIS = `
REGRAS DO JUMP OS:
- Responda SEMPRE em português brasileiro, direto e aplicável ao nicho do cliente (use as MEMÓRIAS abaixo).
- ENTREGUE PRIMEIRO, PERGUNTE DEPOIS: se as memórias dão base mínima, produza a entrega completa AGORA assumindo o mais provável (deixe claro o que assumiu). No máximo 1 pergunta opcional AO FINAL para refinar. NUNCA responda só com lista de perguntas — exceto o check-in do Agente de Identidade, que é guiado.
- Nunca invente dados de desempenho; peça ou use o que o cliente trouxer.
- Respostas objetivas: máximo ~350 palavras, salvo entregas (roteiros/calendários) que pedem mais.
- AUTO-APRENDIZADO: quando descobrir algo novo e DURADOURO sobre o negócio/nicho/preferências do cliente (ex: nicho, público, tom, produto carro-chefe, concorrente principal, horário que funciona), registre ao FINAL da resposta:
<memoria>{"chave":"nome_curto","valor":"o que aprendeu"}</memoria>
(uma tag por aprendizado, no máximo 8 por resposta; não repita memórias já listadas)`;

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'Método não permitido'});

  try {
    // Auth
    const jwt=(req.headers.authorization||'').replace('Bearer ','');
    if(!jwt) return res.status(401).json({error:'Não autenticado'});
    const uRes=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{'apikey':KEY(),'Authorization':`Bearer ${jwt}`}});
    const user=await uRes.json();
    if(!uRes.ok||!user.id) return res.status(401).json({error:'Sessão inválida'});

    const { agente, mensagem } = req.body||{};
    if(!agente||!PERSONAS[agente]) return res.status(400).json({error:'Agente inválido'});
    if(!mensagem||!mensagem.trim()) return res.status(400).json({error:'Mensagem vazia'});
    if(mensagem.length>4000) return res.status(400).json({error:'Mensagem muito longa'});

    // Cliente + plano + limites
    const [cli]=await sbGet(`clientes?id=eq.${user.id}&select=*`);
    if(!cli) return res.status(403).json({error:'Conta não encontrada'});
    if(cli.bloqueado) return res.status(403).json({error:'Conta bloqueada'});
    const nivel=LV[cli.plano]||1;
    if(NIVEL[agente]>nivel){
      const need=NIVEL[agente]===2?'Plus':'Pro';
      return res.status(403).json({error:`Este agente faz parte do plano ${need}.`});
    }
    const mesAtual=new Date().toISOString().slice(0,7);
    let uso=cli.uso||{};
    if(uso.mes!==mesAtual){
      uso={tokens:0,imagens:0,videos:0,trafego_sugestoes:0,mes:mesAtual};
      await sbPatch(`clientes?id=eq.${user.id}`,{uso});
    }
    const lim=cli.limites||{};
    if(lim.tokens&&Number(uso.tokens||0)>=Number(lim.tokens)){
      return res.status(403).json({error:'Limite mensal de uso atingido.',limite:true});
    }

    // Acervo de imagens (pré-requisito do Identidade)
    let acervoTxt='';
    if(agente==='identidade'){
      try{
        const ups=await sbGet(`uploads?user_id=eq.${user.id}&select=categoria`);
        const cats={};(Array.isArray(ups)?ups:[]).forEach(u=>cats[u.categoria]=(cats[u.categoria]||0)+1);
        const logo=cats.logo||0,pess=cats.pessoais||0,prod=cats.produtos||0;
        acervoTxt=`\nACERVO DE IMAGENS DO CLIENTE: logo=${logo}, fotos pessoais=${pess}, produtos=${prod}.`
          +((logo+pess+prod)===0?' ATENÇÃO: acervo VAZIO — peça para enviar imagens em "Meus arquivos" ANTES de iniciar a consultoria.':' Acervo disponível — pode analisar a identidade visual.');
      }catch(e){}
    }

    // Memórias (agente + globais)
    let mems=await sbGet(`memorias?user_id=eq.${user.id}&or=(agente.eq.${agente},agente.eq.global)&select=chave,valor&limit=40`);
    if(!Array.isArray(mems))mems=[];
    const memTxt=(mems||[]).length
      ? 'MEMÓRIAS SOBRE ESTE CLIENTE:\n'+(mems||[]).map(m=>`- ${m.chave}: ${m.valor}`).join('\n')
      : 'MEMÓRIAS: ainda nenhuma — você está conhecendo este cliente agora.';

    // Histórico recente
    let hist=await sbGet(`chat_mensagens?user_id=eq.${user.id}&agente=eq.${agente}&order=created_at.desc&limit=10&select=role,conteudo`);
    if(!Array.isArray(hist))hist=[];
    const messages=(hist||[]).reverse().map(m=>({role:m.role==='user'?'user':'assistant',content:m.conteudo}));

    // VISÃO: o Identidade enxerga a logo/criativos reais para extrair cores e estilo
    let conteudoUser=mensagem;
    if(agente==='identidade' && /analis|cor|identidade|logo|marca|come[çc]ar|iniciar|sim/i.test(mensagem)){
      try{
        const imgs=await sbGet(`uploads?user_id=eq.${user.id}&categoria=in.(logo,criativos,produtos)&select=url,categoria&limit=3`);
        const arr=Array.isArray(imgs)?imgs:[];
        if(arr.length){
          const blocks=[];
          for(const im of arr){
            try{
              const r=await fetch(im.url);
              if(r.ok){
                const ct=r.headers.get('content-type')||'image/png';
                if(/image\/(png|jpe?g|webp|gif)/.test(ct)){
                  const buf=Buffer.from(await r.arrayBuffer());
                  if(buf.length<4500000){ // <4.5MB
                    blocks.push({type:'image',source:{type:'base64',media_type:ct.split(';')[0],data:buf.toString('base64')}});
                  }
                }
              }
            }catch(e){}
          }
          if(blocks.length){
            blocks.push({type:'text',text:mensagem+'\n\n[As imagens acima são a logo/criativos REAIS do cliente. Extraia as cores exatas (hex aproximados), a tipografia aparente e avalie a qualidade visual a partir delas.]'});
            conteudoUser=blocks;
          }
        }
      }catch(e){}
    }
    messages.push({role:'user',content:conteudoUser});

    const system=`${PERSONAS[agente]}\n\nCLIENTE: ${cli.nome||'—'} · Plano ${cli.plano||'basico'}.${acervoTxt}\n${memTxt}\n${REGRAS_GERAIS}`;

    // Anthropic
    const aRes=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL(),max_tokens:(agente==='identidade'||agente==='estrategia')?3000:1100,system,messages}),
    });
    const data=await aRes.json();
    if(!aRes.ok){
      console.error('anthropic:',JSON.stringify(data).slice(0,300));
      return res.status(500).json({error:'O agente está indisponível agora. Tente em instantes.'});
    }
    let texto=(data.content||[]).map(c=>c.text||'').join('');

    // Extrair instrução de geração de imagem
    let imgReq=null;
    texto=texto.replace(/<gerar_imagem>([\s\S]*?)<\/gerar_imagem>/g,(_,j)=>{
      try{const o=JSON.parse(j.trim());if(o.prompt)imgReq=o}catch(e){}
      return '';
    });

    // Extrair aplicação de tema (Identidade customiza a dashboard)
    let aplicarTema=null;
    texto=texto.replace(/<aplicar_tema>([\s\S]*?)<\/aplicar_tema>/g,(_,j)=>{
      try{const o=JSON.parse(j.trim());if(o.c1)aplicarTema=o}catch(e){}
      return '';
    });
    if(aplicarTema){
      try{
        const temaAtual=Object.assign({},cli.tema||{},aplicarTema,{bg:(cli.tema&&cli.tema.bg)||'escuro'});
        await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${user.id}`,{method:'PATCH',headers:H(),body:JSON.stringify({tema:temaAtual})});
      }catch(e){}
    }

    // Extrair ordens de serviço entre agentes (registra para execução)
    const ordens=[];
    texto=texto.replace(/<ordem_servico>([\s\S]*?)<\/ordem_servico>/g,(_,j)=>{
      try{const o=JSON.parse(j.trim());if(o.para&&o.tarefa)ordens.push(o)}catch(e){}
      return '';
    });
    if(ordens.length){
      try{
        await Promise.all(ordens.map(o=>fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`,{
          method:'POST',headers:H(),
          body:JSON.stringify({user_id:user.id,de_agente:agente,para_agente:o.para,tarefa:o.tarefa,detalhe:o.detalhe||'',status:'pendente'})
        }).catch(()=>{})));
      }catch(e){}
    }

    // Auto-aprendizado: extrair memórias
    const novas=[];
    texto=texto.replace(/<memoria>([\s\S]*?)<\/memoria>/g,(_,j)=>{
      try{const o=JSON.parse(j.trim());if(o.chave&&o.valor)novas.push(o)}catch(e){}
      return '';
    });
    const agSave=(agente==='identidade')?'global':agente;
    const memWrites=novas.slice(0,8).map(m=>
      sbUpsert('memorias',{user_id:user.id,agente:agSave,chave:String(m.chave).slice(0,60),valor:String(m.valor).slice(0,500),updated_at:new Date().toISOString()})
    );

    // Check-in concluído (agente identidade)
    let checkin=false;
    if(texto.includes('<checkin_completo/>')){
      texto=texto.replace(/<checkin_completo\/>/g,'').trim();
      checkin=true;
      const ob=Object.assign({},cli.onboarding||{},{checkin:true});
      await sbPatch(`clientes?id=eq.${user.id}`,{onboarding:ob});
    }
    texto=texto.trim();

    // Persistir tudo em paralelo (memórias + conversa + uso)
    const gastos=((data.usage&&(data.usage.input_tokens+data.usage.output_tokens))||800);
    const novoUso=Object.assign({},uso,{tokens:Number(uso.tokens||0)+gastos});
    const limTok=Number(lim.tokens||0);
    if(limTok&&!uso.avisado80&&novoUso.tokens>=limTok*0.8){
      novoUso.avisado80=true;
      memWrites.push(sbInsert('recados',{user_id:user.id,tipo:'alerta',titulo:'80% do uso mensal atingido',mensagem:'Você já usou 80% dos seus tokens do mês. Se precisar de mais, solicite o aumento ao seu gestor direto pelo chat dos agentes.',lido:false,resolvido:false}));
    }
    await Promise.all([
      ...memWrites,
      sbInsert('chat_mensagens',[
        {user_id:user.id,agente,role:'user',conteudo:mensagem},
        {user_id:user.id,agente,role:'assistant',conteudo:texto},
      ]),
      sbPatch(`clientes?id=eq.${user.id}`,{uso:novoUso}),
    ]);

    return res.status(200).json({resposta:texto,memorias_novas:novas.length,checkin,tokens:novoUso.tokens,gerar_imagem:imgReq,aplicar_tema:aplicarTema,ordens:ordens.length});
  } catch(err){
    console.error('agente-chat:',err.message);
    return res.status(500).json({error:'Erro interno do agente'});
  }
};

module.exports = handler;
module.exports.config = { maxDuration: 60 };
