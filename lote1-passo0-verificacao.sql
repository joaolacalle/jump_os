-- ============================================================
-- LOTE 1 — TRAVA DE DUPLICIDADE — PASSO 0: VERIFICAÇÃO (só leitura)
-- ============================================================
-- Rode isto PRIMEIRO, antes do arquivo de migration. É 100% seguro:
-- só lê dados, não grava nada, não trava nenhuma tabela.
--
-- O que faz: procura, nos dados de HOJE, qualquer conteúdo que já
-- tenha mais de 1 ordem de produção ATIVA ao mesmo tempo (criar_post
-- ou criar_avulso, pendente ou processando, fora de ajuste de slide)
-- — exatamente o que a nova restrição do banco vai passar a impedir
-- fisicamente a partir de agora.
--
-- COMO LER O RESULTADO:
--   • ZERO linhas retornadas → os dados atuais já respeitam a regra.
--     A migration (lote1-passo1-migration.sql) pode ser aplicada sem
--     nenhum ajuste manual antes.
--   • Alguma linha retornada → existe HOJE um conteúdo com 2+ ordens
--     de produção ativas ao mesmo tempo. NÃO aplique a migration
--     ainda — cole o resultado desta consulta na conversa antes,
--     pra decidirmos juntos o que fazer com essas ordens (cancelar
--     a mais antiga, verificar se a arte já saiu em dobro, etc.)
--     antes de a restrição existir.
-- ============================================================

SELECT
  conteudo_id,
  COUNT(DISTINCT ordem_id) AS ordens_ativas,
  array_agg(DISTINCT ordem_id) AS ids_das_ordens
FROM (
  SELECT id AS ordem_id, (elem)::uuid AS conteudo_id
  FROM ordens_servico, jsonb_array_elements_text(payload->'ids') AS elem
  WHERE tarefa IN ('criar_post','criar_avulso')
    AND status IN ('pendente','processando')
    AND (payload->>'slide') IS NULL
    AND payload ? 'ids'
) t
GROUP BY conteudo_id
HAVING COUNT(DISTINCT ordem_id) > 1;
