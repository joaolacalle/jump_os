// assets/classificacao.js — JUMP OS: FONTE ÚNICA de classificação de conteúdo
// VERSAO: bump obrigatório a cada alteração (mesmo padrão do jump-core.js) — o ?v= nas páginas
// força o navegador a baixar o build novo.
//
// POR QUE ESTE ARQUIVO EXISTE (ver APRENDIZADOS.md — "A2, causa raiz", 25/ago/2026):
// existiam NOVE pontos no código decidindo, cada um por conta própria, se um conteúdo é
// produzível como imagem pelo Engine 6.0 ou depende de material que só o cliente tem (vídeo de
// reels). Quatro regras diferentes, divergentes entre si. Um desses pontos (aprovar.html) nunca
// excluía reels — e foi o que produziu uma ordem "concluída" sem gerar nenhuma imagem, em
// silêncio, porque o filtro que de fato existia (cron.js) só agia DEPOIS, reduzindo a lista a
// zero e fechando a ordem como se estivesse tudo pronto.
//
// A partir de agora, QUALQUER ponto do código que precise saber "isto é produzível em imagem ou
// depende de material do usuário" consulta ESTE arquivo. Nenhum ponto novo testa formato com
// regex ou lista própria — a lista mora só aqui.
//
// Funciona nos dois mundos do projeto, que não têm bundler: `require()` no Node (api/*.js) e
// <script src="assets/classificacao.js"> no navegador (páginas HTML). Por isso o padrão UMD
// abaixo — um único arquivo, sem duplicar a lógica em dois lugares que podem divergir de novo.
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  if (root) { root.JUMP_CLASS = mod; }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {

  var CATEGORIA = { PRODUCAO_IMAGEM: 'PRODUCAO_IMAGEM', MATERIAL_USUARIO: 'MATERIAL_USUARIO' };

  // ÚNICA lista de formatos que dependem de material do usuário (vídeo que só o cliente tem —
  // o Engine 6.0 não produz vídeo, só imagem). Tudo que NÃO bater aqui é PRODUCAO_IMAGEM,
  // inclusive formatos desconhecidos/inesperados (mesmo critério que já valia em cron.js:644-650,
  // o único ponto que de fato barra produção hoje — agora generalizado pra todos os pontos).
  var FORMATOS_MATERIAL_USUARIO = ['reel', 'reels', 'video', 'vídeo'];

  // Formatos que pedem enquadramento vertical (single-frame 1080x1920) na peça — mesmo sendo
  // PRODUCAO_IMAGEM no caso de 'story' (é imagem, só que vertical). Não confundir com a lista
  // acima: 'reel' está nas duas (é vertical E depende de material do usuário); 'story' está só
  // nesta (é vertical, mas o Engine 6.0 produz normalmente).
  var FORMATOS_VERTICAL = ['reel', 'story'];

  // QUARENTENA (25/ago/2026): formatos que são PRODUCAO_IMAGEM (o Engine 6.0 sabe produzir,
  // tecnicamente) mas cujo caminho de produção automática NUNCA foi validado de ponta a ponta em
  // produção real. Hoje só 'story': o pipeline gera e corta a peça na dimensão certa (1080x1920,
  // via FORMATOS_VERTICAL), mas a zona de segurança de texto usada é emprestada da regra de
  // reels ("REELS safe zones", gerar-imagem.js) — a interface real do Instagram sobre um Story
  // (barra de resposta, ícones) não é a mesma de um Reels, e ninguém viu o resultado visual de um
  // story gerado automaticamente. Até então, todo caminho de criação de ordem excluía story (por
  // acidente, não por decisão documentada — ver APRENDIZADOS.md), então nunca foi testado.
  // Aplicada por enquanto SÓ no backstop (agente-chat.js), que é o disparo automático mais
  // amplo (roda a cada interação de chat, sem o usuário pedir). ATENÇÃO — gap conhecido, não
  // resolvido: "criador semanal" (agente-chat.js) e a aprovação manual da Semana 1
  // (aprovar.html) ainda NÃO consultam esta lista — um story pode teoricamente chegar à
  // produção por esses outros caminhos. Não foi escopo desta rodada; registrado no
  // APRENDIZADOS.md para decisão futura.
  // Tirar da quarentena exige validar o resultado visual real de um story gerado, não só
  // confirmar que o pipeline aceita o formato sem erro.
  var FORMATOS_EM_VALIDACAO = ['story'];

  // PISO DA JANELA "SEMANA 1" (25/ago/2026): dias para trás, a partir de hoje, que ainda contam
  // como "semana atual" para fins de detalhamento/produção. Existia como literal duplicado em
  // dois lugares (aprovar.html, ao montar o card da Semana 1) e SÓ num deles (agente-chat.js,
  // ao montar a lista que o agente detalha) — o segundo não tinha piso nenhum, o que fazia o
  // agente detalhar backlog de semanas atrás em vez do plano recém-aprovado, e o resultado caía
  // fora da janela do card. Mesmo padrão de bug já visto neste projeto (regra igual escrita em
  // dois lugares, ou um lugar sem a regra) — por isso mora aqui, não como literal em cada arquivo.
  // aprovar.html ainda tem o literal embutido (7*864e5) — não foi trocado por esta constante
  // nesta rodada (escopo era só a query de agente-chat.js); os dois valores são iguais hoje, mas
  // a extração de aprovar.html fica pendente como correção separada.
  var PISO_SEMANA1_DIAS = 7;

  // STATUS "AGUARDANDO MATERIAL" (Etapa 2, 26/ago/2026): conteúdo MATERIAL_USUARIO (reels/vídeo)
  // que já tem copy/headline prontos, mas ainda não tem o arquivo do cliente. Antes esse
  // conteúdo era só removido das listas de produção de imagem — nunca virava nada, nunca
  // avisava ninguém, simplesmente desaparecia (ficava em 'rascunho' pra sempre, sem card em
  // lugar nenhum). Agora vira card imediatamente, esperando só o upload.
  // `status` é campo de texto livre (confirmado: sem enum, sem migration necessária) — mora
  // aqui, não como literal em cada arquivo que precisa gravar ou comparar esse valor.
  var STATUS_AGUARDANDO_MATERIAL = 'aguardando_material';

  function _fmt(conteudoOuFormato) {
    if (typeof conteudoOuFormato === 'string') return conteudoOuFormato.toLowerCase();
    return String((conteudoOuFormato && conteudoOuFormato.formato) || 'feed').toLowerCase();
  }

  function _bateAlguma(f, lista) {
    for (var i = 0; i < lista.length; i++) { if (f.indexOf(lista[i]) >= 0) return true; }
    return false;
  }

  // Aceita tanto um conteúdo ({formato:'reels', ...}) quanto uma string de formato direto.
  function ehMaterialUsuario(conteudoOuFormato) {
    return _bateAlguma(_fmt(conteudoOuFormato), FORMATOS_MATERIAL_USUARIO);
  }

  function ehVertical(conteudoOuFormato) {
    return _bateAlguma(_fmt(conteudoOuFormato), FORMATOS_VERTICAL);
  }

  // Em quarentena de produção automática (ver FORMATOS_EM_VALIDACAO acima).
  function emValidacao(conteudoOuFormato) {
    return _bateAlguma(_fmt(conteudoOuFormato), FORMATOS_EM_VALIDACAO);
  }

  function classificar(conteudoOuFormato) {
    return ehMaterialUsuario(conteudoOuFormato) ? CATEGORIA.MATERIAL_USUARIO : CATEGORIA.PRODUCAO_IMAGEM;
  }

  // ═══ ANCORAGEM DAS SEMANAS (28/ago/2026 — ver APRENDIZADOS.md, "ANCORAGEM DAS SEMANAS") ═══
  // POR QUE ESTAS TRÊS FUNÇÕES EXISTEM: um plano mensal aprovado em 27/ago devolveu posts
  // datados 10, 12 e 14/set — fora da janela simétrica ±7 dias que várias partes do código
  // calculavam cada uma por conta própria (mesmo padrão de bug já visto neste arquivo: regra
  // igual, ou divergente, escrita em lugares diferentes). O card da Semana 1 nunca nasceu, a
  // copy nunca foi escrita — silenciosamente. A partir de agora, QUALQUER ponto que precise
  // saber "disto quais 5 semanas o plano cobre" ou "de qual semana é este post" chama as
  // funções abaixo. Nenhum ponto novo calcula piso/teto de data por conta própria.
  //
  // Semana 1 = do dia da aprovação mensal até o domingo anterior ao próximo "dia de lote"
  // (parcial, a não ser que a aprovação caia exatamente no dia de lote — aí já nasce completa).
  // Semanas 2-5 = 7 dias corridos cada, começando sempre no dia de lote configurado
  // (padrão = segunda-feira; ver Configurações → Ciclo de produção).
  //
  // IDENTIDADE DA SEMANA (item 2 do pedido): decidida como FUNÇÃO, não como campo persistido
  // por post — a única coisa gravada é a âncora (clientes.preferencias.plano_ancora_em, mesmo
  // padrão já usado por dia_lote: JSONB existente, sem migration). Antes da aprovação real, o
  // card mensal recalcula "como se fosse aprovado hoje" (âncora = hoje) — um post perto do
  // limite de uma semana pode reclassificar se a aprovação demorar; é o reflexo da data real,
  // não um bug.
  //
  // Datas são strings 'YYYY-MM-DD' comparadas/calculadas em UTC puro (Date.UTC), nunca com o
  // fuso do servidor nem do navegador — evita o mesmo tipo de divergência silenciosa entre
  // Node (Vercel, UTC) e o navegador do cliente que já causou bug de datas neste projeto antes.
  function _toDataUTC(iso) {
    var s = String(iso == null ? '' : iso).slice(0, 10);
    var p = s.split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }
  function _isoData(d) { return d.toISOString().slice(0, 10); }
  function _maisDias(d, n) { return new Date(d.getTime() + n * 86400000); }

  // Retorna as 5 janelas da semana ({semana:1..5, inicio:'YYYY-MM-DD', fim:'YYYY-MM-DD'}) do
  // plano ancorado em `ancoraISO`. `diaLote` é o dia da semana (0=domingo..6=sábado) em que a
  // semana COMEÇA — mesmo campo de clientes.preferencias.dia_lote; ausente/inválido usa 1
  // (segunda), o padrão do sistema.
  function janelasSemanas(ancoraISO, diaLote) {
    var dl = Number(diaLote);
    if (!(dl >= 0 && dl <= 6)) dl = 1;
    var ancora = _toDataUTC(ancoraISO);
    var proximo = _maisDias(ancora, 1);
    while (proximo.getUTCDay() !== dl) { proximo = _maisDias(proximo, 1); }
    var janelas = [{ semana: 1, inicio: _isoData(ancora), fim: _isoData(_maisDias(proximo, -1)) }];
    for (var i = 0; i < 4; i++) {
      var ini = _maisDias(proximo, i * 7);
      janelas.push({ semana: i + 2, inicio: _isoData(ini), fim: _isoData(_maisDias(ini, 6)) });
    }
    return janelas;
  }

  // A quais das 5 semanas pertence `dataSugerida` ('YYYY-MM-DD' ou ISO completo — só a parte da
  // data é usada)? Retorna 1..5, ou null se a data cai fora do horizonte do plano (a chamadora
  // decide o que fazer com null — a REGRA deste projeto é recusar e avisar, nunca corrigir pra
  // dentro da janela mais próxima; ver "trava de datas" em api/agente-chat.js).
  function semanaDoPost(dataSugerida, ancoraISO, diaLote) {
    if (!dataSugerida) return null;
    var alvo = String(dataSugerida).slice(0, 10);
    var janelas = janelasSemanas(ancoraISO, diaLote);
    for (var i = 0; i < janelas.length; i++) {
      if (alvo >= janelas[i].inicio && alvo <= janelas[i].fim) return janelas[i].semana;
    }
    return null;
  }

  // {inicio,fim} do horizonte inteiro do plano (Semana 1 até o fim da Semana 5).
  function horizonteDoPlano(ancoraISO, diaLote) {
    var janelas = janelasSemanas(ancoraISO, diaLote);
    return { inicio: janelas[0].inicio, fim: janelas[janelas.length - 1].fim };
  }

  return {
    CATEGORIA: CATEGORIA,
    FORMATOS_MATERIAL_USUARIO: FORMATOS_MATERIAL_USUARIO,
    FORMATOS_VERTICAL: FORMATOS_VERTICAL,
    FORMATOS_EM_VALIDACAO: FORMATOS_EM_VALIDACAO,
    PISO_SEMANA1_DIAS: PISO_SEMANA1_DIAS,
    STATUS_AGUARDANDO_MATERIAL: STATUS_AGUARDANDO_MATERIAL,
    ehMaterialUsuario: ehMaterialUsuario,
    ehVertical: ehVertical,
    emValidacao: emValidacao,
    classificar: classificar,
    janelasSemanas: janelasSemanas,
    semanaDoPost: semanaDoPost,
    horizonteDoPlano: horizonteDoPlano
  };
});
