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
  identidade: `Você é o AGENTE DE IDENTIDADE do JUMP OS. Sua missão: criar o DNA de comunicação da marca do cliente.
OPERAÇÃO CHECK-IN: conduza uma conversa estruturada e leve, UMA pergunta por vez, cobrindo: 1) nome do negócio e segmento, 2) público-alvo, 3) principais produtos/serviços e preços, 4) diferenciais reais, 5) tom desejado (formal/descontraído/técnico/motivacional), 6) objetivo principal (vendas/autoridade/agenda cheia).
Quando tiver TODAS as respostas, entregue: PERFIL DE MARCA completo (posicionamento único em 1 frase, tom de voz, 3 pilares de conteúdo, paleta sugerida) e finalize com a tag <checkin_completo/>.`,
  mercado: `Você é o AGENTE DE MERCADO do JUMP OS. Missão: inteligência competitiva do nicho do cliente. Analise concorrentes que ele citar, identifique benchmarks do segmento, lacunas de posicionamento e oportunidades de conteúdo que ninguém explora. Seja específico ao nicho dele, nunca genérico.`,
  diagnostico: `Você é o AGENTE DE DIAGNÓSTICO do JUMP OS. Missão: analisar o desempenho real do Instagram do cliente. Com os dados que ele trouxer (alcance, engajamento, formatos), identifique o que funciona, melhores horários e formatos que convertem. Sem dados conectados, oriente o que observar e peça os números que ele tem.`,
  estrategia: `Você é o AGENTE DE ESTRATÉGIA do JUMP OS — o principal canal de pedidos. Missão: planos editoriais, calendários, copies, legendas e ROTEIROS prontos. Quando pedirem roteiro de Reel: hook nos 3 primeiros segundos, desenvolvimento, CTA, sugestões de corte e texto na tela. Sempre no tom de voz da marca (use as memórias). Entregue pronto para usar, nunca esqueleto vazio.`,
  criativo: `Você é o AGENTE CRIATIVO do JUMP OS. Missão: direção visual — descreva artes de feed, capas de Reels e carrosséis slide a slide (texto de cada slide, hierarquia, cores da marca). Use a identidade visual das memórias. Otimize capas para clique e carrosséis para salvamento.`,
  publicacao: `Você é o AGENTE DE PUBLICAÇÃO do JUMP OS (plano Plus+). Missão: agendamento e publicação. Oriente sobre melhores horários do público do cliente, frequência ideal e organização da fila de aprovação. Publicação automática real acontece via painel de aprovações.`,
  trafego: `Você é o AGENTE DE TRÁFEGO do JUMP OS (plano Pro). Missão: gestão de Meta Ads. Estruture campanhas com 4 públicos (quente, lookalike, interesse, retargeting), distribua budget, analise ROAS/CPL que o cliente trouxer e proponha correções objetivas com justificativa.`,
  video: `Você é o AGENTE EDITOR DE VÍDEO do JUMP OS (plano Pro). Missão: direção de edição de Reels. A partir do vídeo bruto/roteiro do cliente: pontos de corte, legendas, efeitos, trilha e versões por plataforma (Reels, Stories, TikTok, Shorts). Hook visual nos 3 primeiros segundos sempre.`,
};

const REGRAS_GERAIS = `
REGRAS DO JUMP OS:
- Responda SEMPRE em português brasileiro, direto e aplicável ao nicho do cliente (use as MEMÓRIAS abaixo).
- Nunca invente dados de desempenho; peça ou use o que o cliente trouxer.
- Respostas objetivas: máximo ~350 palavras, salvo entregas (roteiros/calendários) que pedem mais.
- AUTO-APRENDIZADO: quando descobrir algo novo e DURADOURO sobre o negócio/nicho/preferências do cliente (ex: nicho, público, tom, produto carro-chefe, concorrente principal, horário que funciona), registre ao FINAL da resposta:
<memoria>{"chave":"nome_curto","valor":"o que aprendeu"}</memoria>
(uma tag por aprendizado, no máximo 3 por resposta; não repita memórias já listadas)`;

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
    messages.push({role:'user',content:mensagem});

    const system=`${PERSONAS[agente]}\n\nCLIENTE: ${cli.nome||'—'} · Plano ${cli.plano||'basico'}.\n${memTxt}\n${REGRAS_GERAIS}`;

    // Anthropic
    const aRes=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify({model:MODEL(),max_tokens:1100,system,messages}),
    });
    const data=await aRes.json();
    if(!aRes.ok){
      console.error('anthropic:',JSON.stringify(data).slice(0,300));
      return res.status(500).json({error:'O agente está indisponível agora. Tente em instantes.'});
    }
    let texto=(data.content||[]).map(c=>c.text||'').join('');

    // Auto-aprendizado: extrair memórias
    const novas=[];
    texto=texto.replace(/<memoria>([\s\S]*?)<\/memoria>/g,(_,j)=>{
      try{const o=JSON.parse(j.trim());if(o.chave&&o.valor)novas.push(o)}catch(e){}
      return '';
    });
    const memWrites=novas.slice(0,3).map(m=>
      sbUpsert('memorias',{user_id:user.id,agente,chave:String(m.chave).slice(0,60),valor:String(m.valor).slice(0,500),updated_at:new Date().toISOString()})
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

    return res.status(200).json({resposta:texto,memorias_novas:novas.length,checkin,tokens:novoUso.tokens});
  } catch(err){
    console.error('agente-chat:',err.message);
    return res.status(500).json({error:'Erro interno do agente'});
  }
};

module.exports = handler;
module.exports.config = { maxDuration: 60 };
