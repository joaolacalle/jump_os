// api/_semana-lib.js — garante o card "Aprovar a Semana" (tarefa `aprovar_semana`)
// Começa com _ → NÃO conta como função serverless na Vercel.
//
// REPARO AVULSO — SEXTA PORTA (05/set/2026, ver APRENDIZADOS.md "GATE DA APROVAÇÃO SEMANAL"
// e "SEXTA PORTA"): extraído do bloco que o cron.js ("criador semanal"/drip) já tinha, pra ser
// consultado também por api/agente-chat.js (detalhamento pelo chat) — mesma regra, um lugar só,
// em vez de reescrita em cada ponto. Família 2 do Contrato de Engenharia: mesma decisão em N
// lugares vira N regras que divergem com o tempo — foi exatamente esse padrão (nunca a mesma
// checagem) que deixou o gate da aprovação semanal com brechas por meses.
//
// Terceiro ponto que cria este mesmo card, aprovar.html:~726-730 (Semana 1, no clique da
// aprovação mensal), NÃO chama esta função — roda no navegador (Supabase client com a sessão do
// próprio usuário), api/*.js roda no servidor (service key) — são runtimes diferentes, não dá
// pra compartilhar o mesmo módulo CommonJS sem introduzir um endpoint novo só pra isso (mudança
// maior, fora do escopo autorizado desta rodada). Ficou com a MESMA query de dedup, replicada
// de propósito — se este arquivo mudar a regra, aprovar.html precisa ser revisado junto.
//
// ENV esperado pelo chamador: SUPABASE_SERVICE_KEY (nenhuma chamada própria a process.env aqui —
// a chave vem por parâmetro, pra este módulo não depender de nenhum contexto de execução específico).

const SUPABASE_URL = 'https://fcdjzubdxikpvcqvalnt.supabase.co';

function H(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
}

// Garante que existe um card 'aprovar_semana' aberto para o usuário cobrindo os `ids` de
// `conteudos` passados — cria se não existir NENHUMA ordem em aberto (aprovar_semana já
// aguardando aprovação, OU um lote criar_post já rodando: mesmo critério que cron.js e
// aprovar.html já usavam, replicado aqui sem mudar a regra); reaproveita (não cria de novo) se
// já existir alguma das duas. Nunca lança — falha vira {criado:false, jaExistia:false}, e quem
// chamou decide o que fazer (avisar o cliente, logar, etc.) — ver uso em agente-chat.js.
async function garantirCardAprovarSemana(serviceKey, userId, ids, deAgente, extraPayload) {
  if (!serviceKey || !userId || !Array.isArray(ids) || !ids.length) {
    return { criado: false, jaExistia: false, ordemId: null };
  }
  const headers = H(serviceKey);
  try {
    const ja = await fetch(
      `${SUPABASE_URL}/rest/v1/ordens_servico?user_id=eq.${userId}&or=(and(tarefa.eq.criar_post,status.eq.pendente),and(tarefa.eq.aprovar_semana,status.eq.aguardando_aprovacao))&select=id&limit=1`,
      { headers }
    ).then(r => r.json());
    if (Array.isArray(ja) && ja.length) {
      return { criado: false, jaExistia: true, ordemId: ja[0].id };
    }
  } catch (e) {
    console.error('[garantirCardAprovarSemana] checagem de dedup falhou (rede) — user=' + userId + ' erro=' + (e && e.message));
    return { criado: false, jaExistia: false, ordemId: null };
  }
  try {
    const payload = Object.assign({ ids }, extraPayload || {});
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ordens_servico`, {
      method: 'POST',
      headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        user_id: userId, de_agente: deAgente || 'estrategia', para_agente: 'usuario',
        tarefa: 'aprovar_semana', detalhe: 'Aprovar a semana (' + ids.length + ' post(s))',
        status: 'aguardando_aprovacao', total: ids.length, progresso: 0, payload,
      }),
    });
    if (!r.ok) {
      let motivo = ''; try { const j = await r.json(); motivo = j.message || j.hint || j.details || JSON.stringify(j).slice(0, 200); } catch (e) {}
      console.error('[garantirCardAprovarSemana] INSERT falhou — status=' + r.status + ' motivo=' + String(motivo).slice(0, 200) + ' user=' + userId);
      return { criado: false, jaExistia: false, ordemId: null };
    }
    const j = await r.json().catch(() => null);
    const id = (Array.isArray(j) && j[0] && j[0].id) || null;
    return { criado: true, jaExistia: false, ordemId: id };
  } catch (e) {
    console.error('[garantirCardAprovarSemana] INSERT falhou (rede) — user=' + userId + ' erro=' + (e && e.message));
    return { criado: false, jaExistia: false, ordemId: null };
  }
}

module.exports = { garantirCardAprovarSemana };
