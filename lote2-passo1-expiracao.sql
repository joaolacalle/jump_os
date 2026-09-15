-- ============================================================
-- LOTE 2 — SEMANA NÃO CUMULATIVA, COM VENCIMENTO — PASSO 1: MIGRATION
-- ============================================================
-- O que isto muda no banco: SÓ UMA COISA. Adiciona 1 coluna nova na tabela
-- conteudos — expirado_em (data/hora em que o post virou 'expirado'). Não
-- toca em nenhuma linha existente, não cria tabela nova, não mexe em RLS,
-- não mexe em nenhuma outra tabela.
--
-- PARA QUE SERVE: 'status' já é campo de texto livre (sem enum, confirmado
-- antes — ver sql/lote1-passo1-migration.sql) — o valor novo 'expirado' não
-- precisa de migration nenhuma, o banco aceita qualquer texto. Mas "quando
-- expirou" (pra contar os 30 dias até a exclusão automática, e pro aviso do
-- dashboard "faltam N dias") precisa de UM CAMPO DE DATA — isso sim precisa
-- existir na tabela antes do código gravar nele.
--
-- SEM ESTA MIGRATION: o job novo (api/cron.js, jobExpiracaoSemana) tenta
-- gravar expirado_em e o PATCH falha silenciosamente pro Supabase rejeitar
-- coluna desconhecida — melhor rodar isto ANTES de subir o código do Lote 2.
--
-- 100% seguro pra rodar em produção com dados existentes: ADD COLUMN
-- IF NOT EXISTS numa coluna nullable, sem default — não bloqueia a tabela
-- por mais que um instante, não quebra nenhuma leitura/escrita existente
-- (todo INSERT/UPDATE que já existe no código continua funcionando sem
-- mencionar esta coluna). Testado localmente (Postgres 16) antes deste
-- arquivo: ALTER TABLE numa tabela com linhas existentes, seguido de
-- SELECT/INSERT/UPDATE nos moldes exatos que o código usa — nenhum quebrou.
-- ============================================================

BEGIN;

ALTER TABLE conteudos ADD COLUMN IF NOT EXISTS expirado_em timestamptz;

COMMIT;

-- Confirmação (opcional, só leitura):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'conteudos' AND column_name = 'expirado_em';
