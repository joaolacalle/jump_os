// api/_texto-lib.js — ECONOMIA DE TOKENS NO TEXTO VISÍVEL DOS AGENTES (29/set/2026, pedido do
// João: "economizar o uso de IA com espaçamentos desnecessários, emojis etc.").
//
// A regra de formatação já existe em prosa (REGRAS_GERAIS: sem **negrito**, sem ###, sem ---,
// no máximo 1 emoji) e é ignorada com frequência — a resposta de 29/set 15:47 do Identidade
// tinha negrito e separadores. Instrução em prosa não é mecanismo: aqui a limpeza vira código.
//
// Onde economiza: cada mensagem do agente volta como ENTRADA nas 10 conversas seguintes
// (histórico em api/agente-chat.js). Texto limpo ao gravar = menos tokens em todo turno futuro.
// A mesma função limpa o histórico já gravado no momento da leitura (conversas antigas).
//
// O que NÃO toca, de propósito: o conteúdo das tags (lidas antes desta limpeza), links em
// markdown [texto](url) que o sistema usa, listas "- item", quebras de linha simples, e os
// emojis de quem escreve texto publicável (Estratégia e Tráfego escrevem legendas e anúncios,
// onde emoji é conteúdo do cliente, não enfeite).

const AGENTES_COM_TEXTO_PUBLICAVEL = ['estrategia', 'trafego'];
const _EMOJI_E_ESPACO = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*[ \t]*/gu;

function limparTextoVisivel(texto, agente) {
  let t = String(texto == null ? '' : texto);
  // negrito markdown (**x**) — nunca renderizado como pretendido e proibido pela regra de estilo
  t = t.replace(/\*\*/g, '');
  // títulos markdown no início da linha (### Título → Título)
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  // linhas só de separador decorativo (---, ═══, ***, ___, ───)
  t = t.replace(/^[ \t]*(?:-{3,}|═{3,}|─{3,}|\*{3,}|_{3,})[ \t]*$/gm, '');
  // no máximo 1 emoji por mensagem, fora de quem escreve texto publicável
  if (!AGENTES_COM_TEXTO_PUBLICAVEL.includes(agente)) {
    let visto = false;
    t = t.replace(_EMOJI_E_ESPACO, (m) => { if (visto) return ''; visto = true; return m; });
    t = t.replace(/(\S)[ \t]{2,}/g, '$1 ');
  }
  // espaços no fim da linha e mais de uma linha em branco seguida
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

module.exports = { limparTextoVisivel, AGENTES_COM_TEXTO_PUBLICAVEL };
