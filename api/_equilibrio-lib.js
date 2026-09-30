// api/_equilibrio-lib.js — EQUILÍBRIO VISUAL DO PLANO TRAVADO EM CÓDIGO (30/set/2026, pedido do
// João: "não pode sair só foto minha em todos os posts — precisa ter variação e equilíbrio").
//
// Antes o mix de tipo_visual era só instrução no prompt da Estratégia ("pessoal no máximo 40%",
// persona, bloco MIX VISUAL e DISTRIBUIÇÃO DE TIPO VISUAL em api/agente-chat.js) — o modelo
// costuma seguir, mas nada garantia. Aqui a regra vira mecanismo: roda sobre o LOTE de posts do
// plano que a Estratégia acabou de emitir, ANTES de gravar, e ajusta o tipo_visual do que passar
// do limite. O agente decide; o código garante. O prompt só informa.
//
// Escopo: só posts do PLANO que viram arte (não avulso, não Reels/vídeo — esses são material do
// cliente, ver assets/classificacao.js:ehMaterialUsuario). Tipos: pessoal (foto real do cliente),
// produto (foto real de produto), conceitual (composição gráfica), pessoa_conceito (pessoa
// genérica). Regras, nesta ordem:
//   1) DISPONIBILIDADE: sem foto pessoal no acervo, "pessoal" vira "pessoa_conceito"; sem foto de
//      produto, "produto" vira "conceitual" — nunca prometer arte com o que não existe.
//   2) FOTO DO CLIENTE NO MÁXIMO 40% do lote (mínimo 1 permitida). O excesso vira "conceitual".
//   3) NENHUM TIPO ACIMA DA METADE do lote (a partir de 3 posts) — é a VARIAÇÃO. O excesso vira o
//      tipo disponível mais em falta (pessoal só enquanto couber nos 40%).
// Ao escolher QUAIS posts ajustar, mantém os que ficam espalhados no calendário e ajusta os que
// formam sequência — o feed não fica com três posts iguais seguidos.

const TIPOS = ['pessoal', 'produto', 'conceitual', 'pessoa_conceito'];
const MAX_PESSOAL = 0.4;
const MAX_TIPO = 0.5;

function _tipo(ct) {
  const t = String((ct && ct.tipo_visual) || 'conceitual').toLowerCase();
  return TIPOS.includes(t) ? t : 'conceitual';
}

// Dos índices (já em ordem de data) de um mesmo tipo, escolhe quais MANTER para `manter` itens
// ficarem o mais espalhados possível; devolve os que devem ser ajustados.
function _excedentesEspalhados(indices, manter) {
  if (manter >= indices.length) return [];
  if (manter <= 0) return indices.slice();
  const ficam = new Set();
  for (let j = 0; j < manter; j++) ficam.add(indices[Math.round(j * (indices.length - 1) / Math.max(1, manter - 1))]);
  if (manter === 1) { ficam.clear(); ficam.add(indices[0]); }
  return indices.filter(i => !ficam.has(i));
}

// posts: array de objetos <conteudo> (mutado no tipo_visual). acervo: {pessoais, produtos}.
// Retorna a lista de ajustes [{tema, de, para, motivo}] — vazia se o lote já estava equilibrado.
function equilibrarPlano(posts, acervo) {
  const temPessoal = Number((acervo || {}).pessoais || 0) > 0;
  const temProduto = Number((acervo || {}).produtos || 0) > 0;
  const ajustes = [];
  const lote = (posts || [])
    .map((ct, i) => ({ ct, i, data: String((ct && ct.data_sugerida) || '') }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.i - b.i));
  const n = lote.length;
  if (!n) return ajustes;
  const mudar = (item, para, motivo) => {
    const de = _tipo(item.ct);
    if (de === para) return;
    item.ct.tipo_visual = para;
    ajustes.push({ tema: String(item.ct.tema || 'post').slice(0, 80), de, para, motivo });
  };

  // 1) disponibilidade
  lote.forEach(it => {
    if (_tipo(it.ct) === 'pessoal' && !temPessoal) mudar(it, 'pessoa_conceito', 'não há foto sua no acervo');
    else if (_tipo(it.ct) === 'produto' && !temProduto) mudar(it, 'conceitual', 'não há foto de produto no acervo');
  });

  // 2) foto do cliente no máximo 40%
  const capPessoal = Math.max(1, Math.floor(n * MAX_PESSOAL));
  const idxPessoal = lote.map((it, k) => (_tipo(it.ct) === 'pessoal' ? k : -1)).filter(k => k >= 0);
  _excedentesEspalhados(idxPessoal, capPessoal).forEach(k => mudar(lote[k], 'conceitual', 'foto sua limitada a 40% do plano'));

  // 3) variação: nenhum tipo acima da metade (a partir de 3 posts)
  if (n >= 3) {
    const capTipo = Math.max(1, Math.ceil(n * MAX_TIPO));
    const disponiveis = TIPOS.filter(t => (t !== 'pessoal' || temPessoal) && (t !== 'produto' || temProduto));
    for (const t of TIPOS) {
      const idx = lote.map((it, k) => (_tipo(it.ct) === t ? k : -1)).filter(k => k >= 0);
      _excedentesEspalhados(idx, capTipo).forEach(k => {
        const conta = {};
        lote.forEach(it => { conta[_tipo(it.ct)] = (conta[_tipo(it.ct)] || 0) + 1; });
        const alvo = disponiveis
          .filter(o => o !== t && (o !== 'pessoal' || (conta.pessoal || 0) < capPessoal) && (conta[o] || 0) < capTipo)
          .sort((a, b) => (conta[a] || 0) - (conta[b] || 0))[0];
        if (alvo) mudar(lote[k], alvo, 'variação: nenhum tipo acima da metade do plano');
      });
    }
  }
  return ajustes;
}

// Resumo do lote em linguagem de cliente, ex.: "8 posts: 3 com sua foto, 4 artes conceituais, 1 com pessoa".
const ROTULO = { pessoal: 'com sua foto', produto: 'com foto de produto', conceitual: 'com arte conceitual', pessoa_conceito: 'com pessoa ilustrativa' };
function resumoMix(posts) {
  const conta = {};
  (posts || []).forEach(ct => { const t = _tipo(ct); conta[t] = (conta[t] || 0) + 1; });
  const partes = TIPOS.filter(t => conta[t]).map(t => conta[t] + ' ' + ROTULO[t]);
  return (posts || []).length + ' post(s) com arte: ' + partes.join(', ');
}

// ── CAPACIDADE DO CLIENTE POR SEMANA (30/set/2026, "Participação do usuário no conteúdo") ──
// Nenhuma semana do plano pode pedir ao cliente mais material (fotos/vídeos dele) do que a
// capacidade de produção que ele informou (assets/classificacao.js:capacidadeSemanal). O excesso
// vira post AUTOMÁTICO (o sistema produz sozinho): post marcado com material perde a marca; Reels
// ou vídeo — que só existem com o vídeo do cliente — vira post de feed com arte conceitual.
// Dentro de cada semana, os primeiros (por data) continuam pedindo material; os seguintes viram
// automáticos. Roda ANTES do equilíbrio visual, para os posts convertidos entrarem na variação.
//   posts: array de <conteudo> (mutado). capSemana: número (Infinity = sem teto). semanaDe(ct): chave da semana.
//   ehMaterial(ct): mesma regra de assets/classificacao.js:ehMaterialUsuario.
function limitarMaterialPorSemana(posts, capSemana, semanaDe, ehMaterial) {
  const ajustes = [];
  if (capSemana === Infinity || capSemana == null) return ajustes;
  const porSemana = {};
  (posts || []).filter(ct => ehMaterial(ct))
    .sort((a, b) => String(a.data_sugerida || '').localeCompare(String(b.data_sugerida || '')))
    .forEach(ct => { const k = String(semanaDe(ct)); (porSemana[k] = porSemana[k] || []).push(ct); });
  Object.keys(porSemana).forEach(k => {
    porSemana[k].slice(capSemana).forEach(ct => {
      const antes = String(ct.formato || 'feed');
      delete ct.material; delete ct.material_pedido;
      if (ehMaterial(ct)) { ct.formato = 'feed'; ct.tipo_visual = 'conceitual'; delete ct.slides; }
      ajustes.push({ tema: String(ct.tema || 'post').slice(0, 80), de: antes, para: String(ct.formato || 'feed') });
    });
  });
  return ajustes;
}

module.exports = { equilibrarPlano, resumoMix, limitarMaterialPorSemana, MAX_PESSOAL, MAX_TIPO, TIPOS };
