-- ============================================================
-- LOTE 2 — LIMPEZA DE DADOS DE TESTE (Semana 2) — SÓ PARA REVISÃO
-- ============================================================
-- NÃO RODE ISTO AINDA. Entregue só para você revisar — combinado no pedido do
-- Lote 2: "a estratégia ativa com posts na Semana 2 pode confundir o teste da
-- nova lógica de semana; entregar o SQL para revisão, sem executar; roda no
-- momento certo, antes do teste."
--
-- Este arquivo tem 2 PASSOS. Rode o PASSO 1 primeiro (só leitura, 100%
-- seguro) e me mande o resultado (ou decida sozinho, se estiver claro pra
-- você) antes de tocar no PASSO 2 — o PASSO 2 muda dado de verdade.
-- ============================================================

-- ── PASSO 1 — LEITURA: quem tem plano ativo, e o que está pendente ──────────
-- Lista cada cliente com um plano mensal já ancorado (plano_ancora_em
-- gravado) e, pra cada um, os conteúdos ainda pendentes de decisão
-- (rascunho/proposto/aguardando_aprovacao/aguardando_copy/aguardando_material)
-- com a data sugerida — pra você comparar com a âncora e o dia de lote do
-- cliente e identificar visualmente quais são "Semana 2" de teste.
SELECT
  c.id                                  AS cliente_id,
  c.nome,
  c.preferencias->>'plano_ancora_em'    AS ancora,
  c.preferencias->>'dia_lote'           AS dia_lote,
  k.id                                  AS conteudo_id,
  k.tema,
  k.status,
  k.data_sugerida,
  k.created_at
FROM clientes c
JOIN conteudos k ON k.user_id = c.id
WHERE c.preferencias->>'plano_ancora_em' IS NOT NULL
  AND k.status IN ('rascunho','proposto','aguardando_aprovacao','aguardando_copy','aguardando_material')
ORDER BY c.id, k.data_sugerida ASC;

-- ── PASSO 2 — LIMPEZA: NÃO RODAR AINDA ───────────────────────────────────────
-- Proposital: SEM um filtro automático de "isto é Semana 2" — calcular a
-- semana certa em SQL puro replicaria a mesma lógica de janelasSemanas()
-- (assets/classificacao.js) numa segunda linguagem, exatamente o padrão de
-- bug que este projeto evita (regra igual escrita em dois lugares, que um
-- dia diverge). Prefiro que você (ou eu, depois de ver o resultado do
-- PASSO 1 e confirmar com você QUAL cliente/quais ids são o teste) preencha
-- os ids abaixo à mão — mais lento, mas sem risco de apagar conteúdo real
-- de um cliente de verdade por engano.
--
-- SOFT DELETE (preserva o dado, mesmo padrão usado no resto do projeto —
-- ver STATUS_EXPIRADO/'excluido' no Lote 2 e 'expirada' em ordens_servico):
-- nunca um DELETE físico aqui.
--
-- BEGIN;
-- UPDATE conteudos
-- SET status = 'excluido'
-- WHERE id IN (
--   -- cole aqui os conteudo_id do PASSO 1 que são de teste, um por linha:
--   -- 'uuid-aqui-1',
--   -- 'uuid-aqui-2'
-- );
-- COMMIT;
