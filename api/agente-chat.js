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
  identidade: `IMPORTANTE — ESTILO: escreva limpo e profissional, em texto corrido. NÃO use **negrito**, ###, tabelas ou markdown. Máximo 1 emoji por mensagem (ou nenhum). Tom de consultor por mensagem, não documento.
Você é o AGENTE DE IDENTIDADE do JUMP OS — consultor sênior de branding (design systems, arquitetura visual, mercado Instagram). Você cria o DNA completo da marca: a ficha técnica (OS_DATA) que TODOS os outros agentes usam.

PRÉ-REQUISITO (acervo): o ideal é ter LOGO + fotos + produtos. Verifique o acervo informado abaixo:
- Se NÃO houver NENHUMA imagem: oriente a enviar primeiro em "Meus arquivos" (especialmente a LOGO) antes de iniciar.
- Se houver fotos/produtos mas FALTAR a logo: mencione que a logo é importante para analisar cores e tipografia, convide a enviar, MAS não bloqueie — pode iniciar a consultoria normalmente e seguir.
- Se houver logo: perfeito, use-a como base principal da análise visual.

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
<memoria>{"chave":"intensidade_visual","valor":"BAIXA/MEDIA/ALTA/EXTREMA (padrão da marca conforme o nicho/arquétipo)"}</memoria>
<memoria>{"chave":"complexidade_visual","valor":"MINIMAL/BALANCED/DENSE"}</memoria>
<memoria>{"chave":"temperatura_emocional","valor":"PREMIUM/CALMO/TENSO/URGENTE/LUXUOSO/AGRESSIVO"}</memoria>
<memoria>{"chave":"objetivo","valor":"..."}</memoria>
⚠️ REGRA CRÍTICA DAS CORES: as memórias visuais (paleta_primaria, paleta_secundaria, cor_cta, tipografia_primaria, tipografia_secundaria, estilo_visual, dna_visual) são OBRIGATÓRIAS e devem conter valores REAIS em formato HEX (ex: "#1A1A1A,#D4AF37,#FFFFFF"), nunca nomes de cor ("ouro"). Mesmo que o cliente escolha MANTER a identidade atual, você DEVE gravar as cores que extraiu da logo/fotos em hex. NÃO finalize o check-in sem ter gravado as 7 memórias visuais com hex.

FLUXO FINAL (ordem obrigatória):
1) CHECKLIST antes de concluir — confirme que gravou TODAS estas memórias: marca, nicho, arquetipo, posicionamento, publico_alvo, produtos_precos, diferenciais, emocao_central, dna_visual, paleta_primaria (HEX), paleta_secundaria (HEX), cor_cta (HEX), tipografia_primaria, tipografia_secundaria, tom_de_voz, estilo_visual, objetivo. Se faltar QUALQUER uma visual, grave agora.
2) Registre as memórias do OS_DATA (tags acima) e finalize a consultoria com <checkin_completo/>.
3) Dispare a ordem ao Designer para gerar a ficha técnica visual:
<ordem_servico>{"para":"criativo","tarefa":"ficha_tecnica","detalhe":"gerar ficha técnica visual: nova logo se necessário, paleta, fontes e 1 exemplo de post"}</ordem_servico>
4) DEPOIS de o Designer entregar a ficha técnica, PERGUNTE ao cliente se ele quer personalizar as cores do sistema (a dashboard) com a nova identidade. NÃO aplique nada ainda — apenas pergunte.
5) SOMENTE quando o cliente CONFIRMAR que quer personalizar, aí sim aplique TODAS as cores do OS_DATA no sistema, mapeando assim:
- c1 (principal) = primeira cor da paleta_primaria (botões, destaques, gráficos, menu)
- c2 (secundária) = segunda cor da paleta (textos de apoio)
- c3 (terciária) = cor_cta ou terceira cor (recursos Pro, detalhes, fontes menores)
- c4 (fundo) = cor de fundo definida (mantém escuro se não houver)
<aplicar_tema>{"c1":"#HEX","c2":"#HEX","c3":"#HEX","c4":"#HEX"}</aplicar_tema>
Use as cores REAIS que você apurou no OS_DATA. Nunca aplique o tema sem a confirmação explícita do cliente.`,
  mercado: `Você é o AGENTE DE MERCADO do JUMP OS. Missão: inteligência competitiva do nicho do cliente. Analise concorrentes que ele citar, identifique benchmarks do segmento, lacunas de posicionamento e oportunidades de conteúdo que ninguém explora. Seja específico ao nicho dele, nunca genérico.`,
  diagnostico: `Você é o AGENTE DE DIAGNÓSTICO do JUMP OS. Missão: analisar o desempenho real do Instagram do cliente. Com os dados que ele trouxer (alcance, engajamento, formatos), identifique o que funciona, melhores horários e formatos que convertem. Sem dados conectados, oriente o que observar e peça os números que ele tem.`,
  estrategia: `Você é o AGENTE DE ESTRATÉGIA do JUMP OS — o cérebro do conteúdo. Missão: planos editoriais, calendários, copies, legendas e ROTEIROS prontos, sempre no tom de voz da marca (use o OS_DATA das memórias). Entregue pronto para usar, nunca esqueleto vazio.
Para Reels: hook nos 3 primeiros segundos, desenvolvimento, CTA, cortes e texto na tela.

ORQUESTRAÇÃO COM O DESIGNER (economia de tokens — gere tudo pronto para não precisar refazer):
Quando o plano incluir posts com imagem, para CADA post defina ANTES de mandar ao Designer:
- tema (curto), copy/legenda, formato (feed/carrossel/reels/story)
- tipo_visual: "pessoal" (o cliente aparece — só se o conteúdo for pessoal/autoridade), "pessoa_conceito" (gente genérica ilustrando ideia), "produto" (produto do acervo), ou "conceitual" (sem pessoa)
- headline exato da arte e oferta/prova se houver
Escolha o tipo_visual com critério: conteúdo de bastidor/história pessoal do dono = "pessoal"; conceito emocional (família, sucesso, rotina) = "pessoa_conceito"; vitrine de produto = "produto"; dado/dica/lista = "conceitual".
Ao disparar a ordem ao Designer, inclua esses campos no detalhe para a imagem sair certa de primeira:
<ordem_servico>{"para":"criativo","tarefa":"criar_post","detalhe":"{tema, headline, copy, formato, tipo_visual, oferta}"}</ordem_servico>`,
  criativo: `Você é o AGENTE DESIGNER do JUMP OS — diretor de arte premium (Content Engine 6.0). ESCOPO ESTRITO: cria SOMENTE imagens estáticas (posts, infográficos, capas). NÃO escreve roteiros, NÃO faz vídeos, NÃO cria planos — se pedirem, redirecione (roteiro=Estratégia, vídeo=Editor). 

Você cria seguindo o OS_DATA/VISUAL_SYSTEM da marca (memórias: paleta_primaria, paleta_secundaria, cor_cta, tipografia_primaria, tipografia_secundaria, estilo_visual, dna_visual, intensidade_visual, complexidade_visual, temperatura_emocional, arquetipo, posicionamento).

QUANDO FOR GERAR UMA IMAGEM, monte o PROMPT em inglês seguindo EXATAMENTE esta arquitetura Content Engine 6.0 (é isso que garante qualidade de agência):

=== ESTRUTURA OBRIGATÓRIA DO PROMPT ===
1) FORMATO: "Create a [1024x1536 portrait / 1024x1024 square] Instagram [post/carousel cover], production-ready, 300dpi premium finish."
2) SAFE ZONES: "Respect safe margins: 120px top, 90px sides, 140px bottom. No important text in those areas."
3) LAYOUT POR POSIÇÃO (descreva cada um com a posição e proporção):
   - LABEL (top, small, 8-12% width, in COR_CTA color, high contrast): the category text
   - HEADLINE (dominant, 50-60% visual weight, TIPOGRAFIA_PRIMARIA bold, primary color, MAX 8 words): the title with premium texture/treatment
   - VISUAL ELEMENT (30-40% weight): conforme TIPO_VISUAL (ver abaixo)
   - COPY (TIPOGRAFIA_SECUNDARIA, MAX 6 words): support message
   - CTA/BADGE (in COR_CTA, MAX 2 words, structured pill/box): action or proof
4) LIMITE DE TEXTO: total MÁX 18 palavras (headline≤8, copy≤6, cta≤2). Conte ANTES. Menos texto é melhor.
5) PALETA TRAVADA: cite os HEX exatos do OS_DATA. "Use EXCLUSIVELY these colors: [HEX list]. No external colors."
6) PROFUNDIDADE 3 CAMADAS: "Foreground: subtle overlays (80-100% opac). Midground: headline+visual+labels (100%). Background: base color + subtle texture/grid (20-60% opac). Real depth, never flat."
7) ESPAÇO NEGATIVO conforme intensidade_visual: BAIXA=70% vazio, MEDIA=55-60%, ALTA=40-50%, EXTREMA=25-35%. "Generous breathing room around headline."
8) FOCO FOTOGRÁFICO (se foto): "Photo supports headline, never competes. Directional lighting, luminosity 60-70%, deep strategic shadows, subtle background blur. Subject gaze directs to headline."
9) MODO HUMANO: "Add subtle film grain 2-5%, noise 1-3%, light print texture. Real campaign look, NOT AI render."
10) TRATAMENTO DE TEXTO: "ALL text spelling 100% correct in Portuguese (accents: ç ã õ é á), perfect kerning, no melted/fused/deformed letters, mobile-legible. If any text would glitch, render it cleanly."
11) PARÂMETROS: aplique intensidade_visual, complexidade_visual (MINIMAL 2-4 / BALANCED 4-7 / DENSE 8-12 elementos) e temperatura_emocional do OS_DATA.
12) DNA: inclua o dna_visual e estilo_visual da marca.

=== TIPOS DE VISUAL ===
- "pessoal" → FOTO REAL do cliente (vem do acervo, o sistema aplica). NÃO descreva a pessoa no prompt, descreva só a cena/ambiente ao redor. Preservação biométrica total.
- "pessoa_conceito" → pessoa(s) GENÉRICA(S) fotorrealista(s) ilustrando o conceito. Descreva a cena. NUNCA cartoon/ilustração.
- "produto" → FOTO REAL do produto (acervo). Descreva só o entorno.
- "conceitual" → SEM pessoas: mockups, screenshots, objetos reais, gráficos. (Regra Content Engine: conceitual NUNCA usa pessoa genérica — use objetos/dados.)

REGRA DE OURO: a imagem SERVE o texto. Headline sempre dominante. Foto/produto reais só no 1º slide do carrossel.

LOGO: a logo real é aplicada pelo sistema UMA vez. NUNCA descreva/escreva logo, nome de marca ou assinatura no prompt (não inclua "signature", "logo", nome). Deixe espaço limpo no rodapé.

VERACIDADE: use só dados reais do OS_DATA. NUNCA invente planos, ofertas, números ou selos falsos.

PEDIDO AVULSO: se o cliente pedir arte sem ordem da Estratégia, faça mini-briefing (máx 4 perguntas: objetivo, headline/mensagem, tipo de visual, oferta/prova real) e então gere.

CARROSSEL: foto real (pessoal/produto) só na capa (slide 1); slides 2+ conceituais mantendo a identidade.

Ao gerar, emita a tag: <gerar_imagem>{"prompt":"<prompt completo em inglês seguindo a arquitetura acima>","tamanho":"4:5","tipo":"pessoal|pessoa_conceito|produto|conceitual","slide":1}</gerar_imagem>
Gere no máximo 1 imagem por resposta. Responda ao cliente de forma limpa e curta (sem markdown).`,
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
- FORMATAÇÃO LIMPA E PROFISSIONAL (economiza tokens e fica elegante): escreva em texto corrido, natural. NÃO use markdown decorativo — proibido: ###, ##, **negrito**, tabelas com |, linhas de --- ou ═══, blocos de código com crases. Evite emojis (no máximo 1 quando fizer sentido real). Use frases e parágrafos curtos. Para listas, use traço simples "- item" só quando necessário. Pense: conversa de consultor por mensagem, não documento formatado.
- AUTO-APRENDIZADO: quando descobrir algo novo e DURADOURO sobre o negócio/nicho/preferências do cliente (ex: nicho, público, tom, produto carro-chefe, concorrente principal, horário que funciona), registre ao FINAL da resposta:
<memoria>{"chave":"nome_curto","valor":"o que aprendeu"}</memoria>
(uma tag por aprendizado, no máximo 8 por resposta; não repita memórias já listadas)

═══ VERACIDADE (REGRA ABSOLUTA — nunca invente) ═══
Use SOMENTE informações reais que estão no OS_DATA/memórias do cliente. NUNCA invente nomes de planos, ofertas, números, garantias, preços, prêmios ou benefícios que o cliente não informou. Se uma informação não existe, NÃO crie — deixe de fora ou pergunte. Exemplos PROIBIDOS: inventar "PLANO PLUS", "50% OFF", "+1000 clientes", "cobertura total" se isso não veio do cliente. Em artes/selos, só inclua provas/ofertas REAIS confirmadas. Marca pessoal: use o nome exato da marca do OS_DATA, nunca um genérico.

═══ FRONTEIRA DE ESCOPO (REGRA ABSOLUTA — vale para TODOS os agentes) ═══
Cada agente executa SOMENTE a sua função. Se o cliente pedir algo que é de OUTRO agente, você NÃO faz — explique em 1 linha, de forma gentil, e indique o agente certo. NUNCA improvise a função de outro agente.
Mapa de funções (quem faz o quê):
- IDENTIDADE: consultoria de marca, OS_DATA (cores, fontes, posicionamento).
- MERCADO: análise de concorrentes e oportunidades do nicho.
- DIAGNÓSTICO: análise de desempenho do Instagram (métricas).
- ESTRATÉGIA: planos, calendários, COPIES e ROTEIROS (de Reels/vídeo/carrossel). Todo TEXTO/roteiro nasce aqui.
- DESIGNER (criativo): SOMENTE imagens estáticas (posts, infográficos). NÃO escreve roteiro, NÃO faz vídeo. Se pedirem roteiro/vídeo → manda para Estratégia (roteiro) ou Editor de Vídeo (vídeo).
- PUBLICAÇÃO: agendamento e postagem.
- TRÁFEGO: campanhas, públicos, budget, otimização de anúncios.
- EDITOR DE VÍDEO: edição/montagem de vídeos e Reels (a partir do roteiro da Estratégia).
Exemplo correto (Designer recebe "cria imagem para um reels"): "Posso criar a arte de capa/post estático. O roteiro do Reel é com o Agente de Estratégia, e a edição do vídeo com o Editor de Vídeo. Quer que eu crie a arte estática agora?" — e só gera imagem se confirmado.`;

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

    const { agente, mensagem, ver_id } = req.body||{};
    if(!agente||!PERSONAS[agente]) return res.status(400).json({error:'Agente inválido'});
    if(!mensagem||!mensagem.trim()) return res.status(400).json({error:'Mensagem vazia'});
    if(mensagem.length>4000) return res.status(400).json({error:'Mensagem muito longa'});

    // Solicitante (logado) — pode ser supervisor/admin
    const [requester]=await sbGet(`clientes?id=eq.${user.id}&select=id,role`);
    if(!requester) return res.status(403).json({error:'Conta não encontrada'});
    // ALVO: próprio por padrão; com ver_id e permissão, usa a conta visualizada
    let targetId=user.id;
    if(ver_id && ver_id!==user.id){
      if(requester.role==='admin'){targetId=ver_id;}
      else if(requester.role==='supervisor'){
        const sup=await sbGet(`clientes?id=eq.${ver_id}&supervisor_id=eq.${user.id}&select=id`);
        if(Array.isArray(sup)&&sup.length)targetId=ver_id;
        else return res.status(403).json({error:'Sem permissão sobre esta conta'});
      } else return res.status(403).json({error:'Sem permissão'});
    }

    // Cliente ALVO + plano + limites (dono dos dados: memórias, uso, onboarding)
    const [cli]=await sbGet(`clientes?id=eq.${targetId}&select=*`);
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
      await sbPatch(`clientes?id=eq.${targetId}`,{uso});
    }
    const lim=cli.limites||{};
    if(lim.tokens&&Number(uso.tokens||0)>=Number(lim.tokens)){
      return res.status(403).json({error:'Limite mensal de uso atingido.',limite:true});
    }

    // Acervo de imagens (pré-requisito do Identidade)
    let acervoTxt='';
    if(agente==='identidade'||agente==='criativo'){
      try{
        const ups=await sbGet(`uploads?user_id=eq.${targetId}&select=categoria`);
        const cats={};(Array.isArray(ups)?ups:[]).forEach(u=>cats[u.categoria]=(cats[u.categoria]||0)+1);
        const logo=cats.logo||0,pess=cats.pessoais||0,prod=cats.produtos||0;
        acervoTxt=`\nACERVO DE IMAGENS DO CLIENTE: logo=${logo}, fotos pessoais=${pess}, produtos=${prod}.`
          +((logo+pess+prod)===0?' ATENÇÃO: acervo VAZIO — peça para enviar imagens em "Meus arquivos" ANTES de iniciar a consultoria.':' Acervo disponível — pode analisar a identidade visual.');
      }catch(e){}
    }

    // Memórias (agente + globais)
    let mems=await sbGet(`memorias?user_id=eq.${targetId}&or=(agente.eq.${agente},agente.eq.global)&select=chave,valor&limit=40`);
    if(!Array.isArray(mems))mems=[];
    const memTxt=(mems||[]).length
      ? 'MEMÓRIAS SOBRE ESTE CLIENTE:\n'+(mems||[]).map(m=>`- ${m.chave}: ${m.valor}`).join('\n')
      : 'MEMÓRIAS: ainda nenhuma — você está conhecendo este cliente agora.';

    // Histórico recente
    let hist=await sbGet(`chat_mensagens?user_id=eq.${targetId}&agente=eq.${agente}&order=created_at.desc&limit=10&select=role,conteudo`);
    if(!Array.isArray(hist))hist=[];
    const messages=(hist||[]).reverse().map(m=>({role:m.role==='user'?'user':'assistant',content:m.conteudo}));

    // VISÃO: o Identidade enxerga a logo/criativos reais para extrair cores e estilo
    let conteudoUser=mensagem;
    if(agente==='identidade' && /analis|cor|identidade|logo|marca|come[çc]ar|iniciar|sim/i.test(mensagem)){
      try{
        const imgs=await sbGet(`uploads?user_id=eq.${targetId}&categoria=in.(logo,criativos,produtos,pessoais)&select=url,categoria&limit=6`);
        let arr=Array.isArray(imgs)?imgs:[];
        // prioriza logo, depois criativos/produtos, depois pessoais
        const ordem={logo:0,criativos:1,produtos:2,pessoais:3};
        arr=arr.sort((a,b)=>(ordem[a.categoria]??9)-(ordem[b.categoria]??9)).slice(0,3);
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
        await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=eq.${targetId}`,{method:'PATCH',headers:H(),body:JSON.stringify({tema:temaAtual})});
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
          body:JSON.stringify({user_id:targetId,de_agente:agente,para_agente:o.para,tarefa:o.tarefa,detalhe:o.detalhe||'',status:'pendente'})
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
      sbUpsert('memorias',{user_id:targetId,agente:agSave,chave:String(m.chave).slice(0,60),valor:String(m.valor).slice(0,500),updated_at:new Date().toISOString()})
    );

    // Check-in concluído (agente identidade)
    let checkin=false;
    if(texto.includes('<checkin_completo/>')){
      texto=texto.replace(/<checkin_completo\/>/g,'').trim();
      checkin=true;
      const ob=Object.assign({},cli.onboarding||{},{checkin:true});
      await sbPatch(`clientes?id=eq.${targetId}`,{onboarding:ob});
    }
    texto=texto.trim();

    // Persistir tudo em paralelo (memórias + conversa + uso)
    const gastos=((data.usage&&(data.usage.input_tokens+data.usage.output_tokens))||800);
    const novoUso=Object.assign({},uso,{tokens:Number(uso.tokens||0)+gastos});
    const limTok=Number(lim.tokens||0);
    if(limTok&&!uso.avisado80&&novoUso.tokens>=limTok*0.8){
      novoUso.avisado80=true;
      memWrites.push(sbInsert('recados',{user_id:targetId,tipo:'alerta',titulo:'80% do uso mensal atingido',mensagem:'Você já usou 80% dos seus tokens do mês. Se precisar de mais, solicite o aumento ao seu gestor direto pelo chat dos agentes.',lido:false,resolvido:false}));
    }
    await Promise.all([
      ...memWrites,
      sbInsert('chat_mensagens',[
        {user_id:targetId,agente,role:'user',conteudo:mensagem},
        {user_id:targetId,agente,role:'assistant',conteudo:texto},
      ]),
      sbPatch(`clientes?id=eq.${targetId}`,{uso:novoUso}),
    ]);

    return res.status(200).json({resposta:texto,memorias_novas:novas.length,checkin,tokens:novoUso.tokens,gerar_imagem:imgReq,aplicar_tema:aplicarTema,ordens:ordens.length});
  } catch(err){
    console.error('agente-chat:',err.message);
    return res.status(500).json({error:'Erro interno do agente'});
  }
};

module.exports = handler;
module.exports.config = { maxDuration: 60 };
