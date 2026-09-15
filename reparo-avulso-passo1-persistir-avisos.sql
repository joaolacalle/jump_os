-- ============================================================
-- REPARO AVULSO — PASSO 1: MIGRATION (persistir avisos no histórico)
-- ============================================================
-- O que isto muda no banco: SÓ UMA COISA. Adiciona 1 coluna nova na tabela
-- chat_mensagens — avisos (texto). Não toca em nenhuma linha existente, não
-- cria tabela nova, não mexe em RLS, não mexe em nenhuma outra tabela.
--
-- PARA QUE SERVE: hoje os avisos do sistema (ex.: "nada foi registrado, peça
-- de novo", "N post(s) não foram gravados", "resposta cortada por ser longa
-- demais") aparecem na tela na hora, mas são só ANEXADOS à resposta do agente
-- DEPOIS de já ter sido gravado no banco — ao recarregar a tela, o aviso
-- desaparece, porque nunca foi salvo. Esta coluna guarda o aviso separado do
-- texto do agente (conteudo), pra sobreviver ao recarregar.
--
-- POR QUE UMA COLUNA SEPARADA, E NÃO GRAVAR TUDO JUNTO EM 'conteudo': o
-- histórico da conversa que volta pro modelo de IA em cada novo turno lê SÓ a
-- coluna 'conteudo' (nunca vai ler 'avisos') — de propósito, pra um aviso
-- operacional do sistema nunca ser confundido pelo modelo com algo que ele
-- mesmo disse.
--
-- 100% seguro pra rodar em produção com dados existentes: ADD COLUMN
-- IF NOT EXISTS numa coluna nullable, sem default — não bloqueia a tabela por
-- mais que um instante, não quebra nenhuma leitura/escrita existente (todo
-- INSERT/UPDATE que já existe no código continua funcionando sem mencionar
-- esta coluna). Mesmo padrão já usado e testado em
-- sql/lote2-passo1-expiracao.sql (coluna expirado_em em conteudos).
-- ============================================================

BEGIN;

ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS avisos text;

COMMIT;

-- Confirmação (opcional, só leitura):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'chat_mensagens' AND column_name = 'avisos';
