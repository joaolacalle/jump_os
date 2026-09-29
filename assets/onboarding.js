// assets/onboarding.js — ONBOARDING EM ORDEM, CONDUZIDO PELO SISTEMA (29/set/2026, decisão do
// João: ordem obrigatória, só na primeira vez).
//
// Antes: quem dizia "próximo passo: vá ao agente X" era o texto de cada agente, e as versões se
// contradiziam (a persona do Identidade dizia que dava para pular Mercado/Diagnóstico; as regras
// gerais citavam Identidade→Mercado→Estratégia, sem Diagnóstico). No teste de 29/set o Identidade
// disse "seu DNA está definido" e mandou para a Estratégia com o check-in recusado em código —
// sem ficha, sem aviso. Agora a ordem, o fim de cada etapa e o próximo passo vivem aqui, em código:
//
//   ORDEM: identidade → mercado → diagnostico → estrategia → onboarding concluído.
//   FIM DE CADA ETAPA (pelo dado, nunca pela fala do agente):
//     identidade  — check-in aceito (trava do DNA completo, já existente em api/agente-chat.js);
//     mercado     — as 4 chaves de mercado gravadas;
//     diagnostico — as 3 chaves de diagnóstico gravadas;
//     estrategia  — primeiro plano (conteúdo não-avulso) gravado.
//   Enquanto não conclui, o cliente só conversa com as etapas já feitas e a etapa atual; qualquer
//   outro agente recebe uma mensagem fixa indicando a etapa pendente (sem chamada de IA).
//
// Estado em clientes.onboarding (JSONB já existente, sem migration):
//   checkin:true   — mantido com o MESMO significado de sempre (Identidade concluída): a ficha
//                    técnica e o gate de acesso em assets/jump-core.js dependem dele.
//   etapas:{identidade,mercado,diagnostico,estrategia} — data ISO de conclusão de cada uma.
//   concluido:ISO  — quando a última etapa fecha.
// Conta com checkin:true e sem `etapas` é anterior a este mecanismo: tratada como concluída, para
// nunca travar quem já estava usando o sistema (em 29/set nenhuma conta estava nesse estado).
//
// Arquivo ÚNICO lido pelo servidor (api/agente-chat.js, via require) e pela tela (agentes.html,
// via <script>, como window.JUMP_ONB) — mesmo padrão de assets/classificacao.js: a regra de qual
// é a etapa atual existe num lugar só, nunca uma cópia no front que diverge da do servidor.

(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  if (root) { root.JUMP_ONB = mod; }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  const ORDEM = ['identidade', 'mercado', 'diagnostico', 'estrategia'];

  const NOME = {
    identidade: 'Agente de Identidade', mercado: 'Agente de Mercado',
    diagnostico: 'Agente de Diagnóstico', estrategia: 'Agente de Estratégia',
    criativo: 'Designer', publicacao: 'Agente de Publicação', trafego: 'Agente de Tráfego', video: 'Editor de Vídeo',
  };

  // Chaves que fecham as etapas de Mercado e Diagnóstico — as mesmas que as personas mandam gravar.
  const CHAVES_ETAPA = {
    mercado: ['concorrentes', 'lacunas_mercado', 'oportunidades', 'formatos_nicho'],
    diagnostico: ['pontos_fortes', 'pontos_corrigir', 'prioridades'],
  };

  function _vazio(v) { return !String(v == null ? '' : v).trim(); }

  // Estado derivado de clientes.onboarding. Nunca escreve nada.
  function estado(onb) {
    const o = onb || {};
    const legado = !!o.checkin && !o.etapas;
    const etapas = Object.assign({}, o.etapas || {});
    if (o.checkin && !etapas.identidade) etapas.identidade = etapas.identidade || 'legado';
    const concluido = !!o.concluido || legado;
    const etapaAtual = concluido ? null : (ORDEM.find(e => !etapas[e]) || null);
    return { concluido: concluido || !etapaAtual, etapaAtual, etapas };
  }

  // O cliente pode conversar com este agente agora? Etapas já feitas e a etapa atual, sim; o resto
  // espera o onboarding terminar.
  function agentePermitido(onb, agente) {
    const st = estado(onb);
    if (st.concluido) return true;
    return agente === st.etapaAtual || !!st.etapas[agente];
  }

  function mensagemBloqueio(agente, etapaAtual) {
    const pos = ORDEM.indexOf(etapaAtual) + 1;
    return 'Ainda não é a vez do ' + (NOME[agente] || 'agente') + '. Seu onboarding segue uma ordem para que, quando você chegar na Estratégia, o DNA do seu negócio esteja completo: '
      + 'Identidade, Mercado, Diagnóstico e Estratégia. '
      + 'Agora você está na etapa ' + pos + ' de 4: abra o ' + NOME[etapaAtual] + ' (é o que está com a bolinha verde na lista) e continue por lá.';
  }

  // Decide se a etapa ATUAL fechou neste turno. `dnaDepois` = DNA já mesclado com o que este turno
  // gravou; `checkinAceito` = check-in do Identidade aceito (agora ou antes); `planoGravado` = a
  // Estratégia gravou ao menos um conteúdo de plano (não-avulso) neste turno.
  function etapaFechou({ agente, etapaAtual, dnaDepois, checkinAceito, planoGravado }) {
    if (!etapaAtual || agente !== etapaAtual) return false;
    if (etapaAtual === 'identidade') return !!checkinAceito;
    if (etapaAtual === 'estrategia') return !!planoGravado;
    const chaves = CHAVES_ETAPA[etapaAtual] || [];
    return chaves.length > 0 && chaves.every(c => !_vazio(dnaDepois && dnaDepois[c]));
  }

  // Novo objeto onboarding com a etapa marcada (e `concluido` se era a última).
  function marcarEtapa(onb, etapa) {
    const o = Object.assign({}, onb || {});
    const agora = new Date().toISOString();
    o.etapas = Object.assign({}, o.etapas || {}, { [etapa]: agora });
    if (etapa === 'identidade') o.checkin = true;
    if (ORDEM.every(e => o.etapas[e])) o.concluido = agora;
    delete o.proximo; // a bolinha do onboarding é derivada das etapas; o campo antigo não guia mais
    return o;
  }

  // Mensagem fixa de fechamento de etapa — escrita pelo sistema, nunca pelo modelo.
  function mensagemEtapaConcluida(etapa, onbNovo) {
    const st = estado(onbNovo);
    const pos = ORDEM.indexOf(etapa) + 1;
    let txt = 'Etapa ' + pos + ' de 4 concluída: ' + NOME[etapa] + '.';
    if (etapa === 'identidade') txt += ' Sua ficha técnica entrou em produção e aparece em Meus Arquivos quando ficar pronta.';
    if (st.concluido) return txt + ' Seu onboarding está completo e todos os agentes estão liberados.';
    return txt + ' Próximo passo: abra o ' + NOME[st.etapaAtual] + ' (bolinha verde na lista de agentes).';
  }

  return { ORDEM: ORDEM, NOME: NOME, CHAVES_ETAPA: CHAVES_ETAPA, estado: estado, agentePermitido: agentePermitido, mensagemBloqueio: mensagemBloqueio, etapaFechou: etapaFechou, marcarEtapa: marcarEtapa, mensagemEtapaConcluida: mensagemEtapaConcluida };
});
