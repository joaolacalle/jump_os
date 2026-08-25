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

  return {
    CATEGORIA: CATEGORIA,
    FORMATOS_MATERIAL_USUARIO: FORMATOS_MATERIAL_USUARIO,
    FORMATOS_VERTICAL: FORMATOS_VERTICAL,
    FORMATOS_EM_VALIDACAO: FORMATOS_EM_VALIDACAO,
    ehMaterialUsuario: ehMaterialUsuario,
    ehVertical: ehVertical,
    emValidacao: emValidacao,
    classificar: classificar
  };
});
