-- ============================================================
-- LOTE 1 — TRAVA DE DUPLICIDADE — PASSO 1: MIGRATION
-- ============================================================
-- ATUALIZADO depois de já aplicado em produção: a função abaixo agora
-- já nasce SECURITY DEFINER (ver lote1-passo3-fix-rls.sql pro porquê
-- — RLS em ordem_itens sem isso bloqueia a trigger e derruba o INSERT
-- inteiro). Isto é só pra quem for aplicar esta migration do zero
-- num ambiente novo — no ambiente que você já rodou, o passo 3 é
-- quem corrige, não é preciso reaplicar este arquivo.
--
-- SÓ rode isto depois de confirmar que lote1-passo0-verificacao.sql
-- retornou ZERO linhas (ou depois de resolvermos juntos qualquer
-- linha que ele tenha retornado).
--
-- O que isto cria (nada disso mexe em dado existente de conteudos
-- nem em nenhuma tabela fora das listadas abaixo):
--   1) uma tabela nova, ordem_itens — espelho de "quais conteúdos
--      cada ordem cobre", mantida 100% automaticamente por trigger;
--      nenhum código da aplicação grava nela diretamente.
--   2) um índice único parcial sobre ordem_itens — a restrição de
--      fato: nenhum conteúdo pode aparecer em 2 linhas "ativas" ao
--      mesmo tempo. É isto que fisicamente impede duas ordens de
--      produção pro mesmo post.
--   3) uma função + trigger que resincronizam ordem_itens toda vez
--      que uma linha de ordens_servico é criada ou atualizada.
--   4) um UPDATE "vazio" (não muda nenhum dado real) só para disparar
--      a trigger acima em cima das ordens que já existem hoje —
--      sem isso, ordem_itens ficaria vazia até a próxima ordem nova.
--
-- Por que não é uma restrição direta na coluna payload (jsonb) de
-- ordens_servico: uma ordem pode cobrir VÁRIOS conteúdos ao mesmo
-- tempo (ex.: aprovar a semana inteira gera 1 ordem com vários ids).
-- O Postgres não tem um jeito nativo de impedir sobreposição entre
-- arrays direto numa UNIQUE constraint — por isso a tabela-espelho:
-- 1 linha por (ordem, conteúdo), aí sim dá pra usar um índice único
-- comum. Testado localmente (Postgres 16, mesma versão do Supabase)
-- antes deste relatório — 9 cenários (ver APRENDIZADOS.md, "LOTE 1"),
-- incluindo: 2ª ordem pro mesmo conteúdo é recusada; concluir uma
-- ordem libera o conteúdo pra uma nova; ajuste de slide (Família B)
-- sempre coexiste, nunca é bloqueado; payload nulo e ordens sem
-- payload.ids não quebram; overlap parcial (1 de 2 ids já ativo)
-- recusa a ordem inteira, não só o item sobreposto.
-- ============================================================

BEGIN;

-- 1) Tabela-espelho. RLS ligado DE PROPÓSITO, sem nenhuma política —
--    só a trigger (SECURITY DEFINER, passo 3 abaixo) deve gravar
--    aqui; nenhum código de aplicação (backend ou navegador) precisa
--    ler nem escrever nela diretamente.
CREATE TABLE IF NOT EXISTS ordem_itens (
  ordem_id uuid NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
  conteudo_id uuid NOT NULL,
  ativo boolean NOT NULL,
  PRIMARY KEY (ordem_id, conteudo_id)
);
ALTER TABLE ordem_itens ENABLE ROW LEVEL SECURITY;

-- 2) A restrição de fato
CREATE UNIQUE INDEX IF NOT EXISTS ux_ordem_itens_ativo
  ON ordem_itens(conteudo_id) WHERE ativo;

-- 3) Função + trigger de sincronização. SECURITY DEFINER + search_path
--    fixo: a tabela tem RLS ativo e ZERO políticas de propósito (só a
--    trigger deve escrever nela) — sem SECURITY DEFINER, a trigger
--    roda com o privilégio de quem disparou o INSERT em
--    ordens_servico (o navegador do cliente, no caminho de
--    aprovar.html), que não tem permissão nenhuma sobre ordem_itens
--    e a trigger falha, derrubando o INSERT inteiro junto (ver
--    lote1-passo3-fix-rls.sql pro teste que reproduziu isso).
CREATE OR REPLACE FUNCTION sync_ordem_itens() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eh_ativa boolean;
BEGIN
  eh_ativa := (NEW.tarefa IN ('criar_post','criar_avulso')
               AND NEW.status IN ('pendente','processando')
               AND (NEW.payload->>'slide') IS NULL);
  DELETE FROM ordem_itens WHERE ordem_id = NEW.id;
  IF NEW.payload ? 'ids' THEN
    INSERT INTO ordem_itens (ordem_id, conteudo_id, ativo)
    SELECT NEW.id, (elem)::uuid, eh_ativa
    FROM jsonb_array_elements_text(NEW.payload->'ids') AS elem;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ordem_itens ON ordens_servico;
CREATE TRIGGER trg_sync_ordem_itens
  AFTER INSERT OR UPDATE ON ordens_servico
  FOR EACH ROW EXECUTE FUNCTION sync_ordem_itens();

-- 4) Backfill das ordens que já existem hoje (dispara a trigger acima
--    sem mudar nenhum dado real). É AQUI que uma violação existente
--    apareceria como erro, se o Passo 0 não tivesse pego antes.
UPDATE ordens_servico SET id = id;

COMMIT;

-- Se tudo correu bem, esta consulta deve retornar pelo menos 1 linha
-- por ordem ativa existente (confirma que o backfill populou):
-- SELECT count(*) FROM ordem_itens;
