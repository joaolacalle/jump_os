-- ============================================================
-- FALHA 3 — COLUNA `origem` EM `conteudos` — PASSO 1: MIGRATION (só a coluna)
-- ============================================================
-- Contexto completo: APRENDIZADOS.md, "FALHA 3 — RELATÓRIO FINAL DA MIGRATION"
-- (09/set/2026) e a entrada anterior de 05/09. Resumo: hoje o sistema decide se
-- um post é do plano mensal ou avulso INFERINDO (por card aprovar_semana
-- aberto/fechado) em pelo menos dois pontos (backstop do Designer em
-- api/agente-chat.js, card da Semana 1 em aprovar.html) — inferência sobre o
-- passado, frágil e já causou o incidente de 04/09 (três artes produzidas sem
-- card aprovado). Esta coluna torna o dado explícito: o post nasce sabendo o
-- que é, em vez de o sistema deduzir depois.
--
-- O que isto muda no banco: SÓ UMA COISA. Adiciona 1 coluna nova em
-- `conteudos` — `origem` (text, nullable) — com 1 CHECK constraint limitando
-- os valores aceitos. Não toca em nenhuma linha existente, não cria tabela
-- nova, não mexe em RLS, não mexe em nenhuma outra tabela, SEM BACKFILL
-- (decisão explícita — ver APRENDIZADOS.md: linhas antigas ficam com
-- `origem IS NULL`, tratado à parte por quem lê, nunca como um dos dois
-- valores).
--
-- VALORES ACEITOS: NULL (linha anterior a esta migration — "não sabemos"),
-- 'plano' (nasceu do plano mensal da Estratégia), 'avulso' (pedido direto do
-- cliente, Tráfego, ou copy_para_criativo). Nenhum terceiro valor passa no
-- CHECK — um erro de digitação no código vira erro de INSERT, não dado sujo
-- silencioso.
--
-- SEM ESTA MIGRATION: o código do passo 2 (INSERT gravando `origem`, backstop
-- e card da Semana 1 lendo `origem`) não pode subir — o INSERT falharia
-- (coluna inexistente) e o sistema pararia de criar conteúdo. Por isso esta
-- migration roda SOZINHA, primeiro, confirmada antes de qualquer linha de
-- código mudar (ordem pedida pelo João).
--
-- SEGURA para rodar em produção com dados existentes:
--   - ADD COLUMN IF NOT EXISTS numa coluna nullable, sem DEFAULT — não
--     bloqueia a tabela por mais que um instante, não quebra nenhum
--     INSERT/UPDATE/SELECT já existente no código (nenhum menciona `origem`
--     hoje).
--   - O CHECK aceita NULL explicitamente — como toda linha existente fica
--     NULL (sem backfill), a validação do constraint passa por construção,
--     sem precisar varrer/travar a tabela por causa de dado incompatível.
--   - Constraint adicionado dentro de um bloco condicional (idempotente: se
--     este script rodar de novo por engano, não quebra por "constraint já
--     existe").
-- ============================================================

BEGIN;

ALTER TABLE conteudos ADD COLUMN IF NOT EXISTS origem text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conteudos_origem_check'
  ) THEN
    ALTER TABLE conteudos
      ADD CONSTRAINT conteudos_origem_check
      CHECK (origem IS NULL OR origem IN ('plano', 'avulso'));
  END IF;
END $$;

COMMIT;

-- Confirmação (opcional, só leitura — rodar depois do COMMIT acima):
-- 1) a coluna existe, é nullable, tipo text:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'conteudos' AND column_name = 'origem';
--
-- 2) o CHECK existe e tem a definição esperada:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'conteudos_origem_check';
--
-- 3) toda linha existente ficou NULL, como esperado (sem backfill):
-- SELECT origem, count(*) FROM conteudos GROUP BY origem;
--   → deve devolver 1 linha só: origem=NULL, count = total de linhas da tabela.
--
-- 4) o CHECK realmente recusa valor fora do conjunto (rodar e conferir que
--    dá erro "violates check constraint" — NÃO commitar, só confirmar o
--    comportamento):
-- BEGIN;
-- UPDATE conteudos SET origem = 'invalido' WHERE id = (SELECT id FROM conteudos LIMIT 1);
-- ROLLBACK;
