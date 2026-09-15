-- ============================================================
-- LOTE 1 — TRAVA DE DUPLICIDADE — PASSO 3: CORRIGE O BLOQUEIO DE RLS
-- ============================================================
-- Problema confirmado e REPRODUZIDO localmente antes deste arquivo
-- (Postgres 16, mesma versão do Supabase): com RLS ativo em
-- ordem_itens e zero políticas, um INSERT em ordens_servico feito por
-- QUALQUER papel que não seja o service_role (ou seja, exatamente o
-- caminho do clique "Aprovar e produzir" em aprovar.html, que grava
-- direto do navegador com o login do próprio cliente) falha assim:
--
--   ERROR: new row violates row-level security policy for table
--   "ordem_itens"
--
-- ...e como a trigger roda DENTRO da mesma transação do INSERT em
-- ordens_servico, o erro derruba a ordem inteira — exatamente o
-- risco que você descreveu. Chamadas feitas pelo backend (agente-
-- chat.js, cron.js — todas usam SUPABASE_SERVICE_KEY) NÃO seriam
-- afetadas, porque o papel service_role já ignora RLS em qualquer
-- tabela por padrão no Supabase — mas o caminho de maior volume
-- (aprovar.html, direto do navegador) quebraria.
--
-- SOLUÇÃO: a trigger passa a rodar como SECURITY DEFINER — ou seja,
-- com o PRIVILÉGIO DE QUEM CRIOU A FUNÇÃO (o dono da tabela,
-- tipicamente "postgres" no Supabase, que já ignora RLS), em vez do
-- privilégio de quem disparou o INSERT original. Isso resolve o
-- bloqueio SEM abrir ordem_itens pra ninguém além da própria trigger
-- — nenhuma política nova é criada, a tabela continua com RLS ativo
-- e zero políticas, ou seja, continua invisível e inescrevível por
-- qualquer cliente (autenticado ou não) via API — só a função, rodando
-- com o privilégio do dono, consegue gravar nela. É a mesma ideia de
-- "a tabela é mantida exclusivamente pela trigger, nunca por código
-- de aplicação" que você descreveu, agora também garantida no nível
-- de permissão do banco, não só por convenção do código.
--
-- ALTERNATIVA CONSIDERADA E DESCARTADA: desativar RLS em ordem_itens
-- por completo, em vez de SECURITY DEFINER. Descartada porque, sem
-- RLS, QUALQUER cliente autenticado poderia ler e ESCREVER na tabela
-- direto pela API do Supabase (toda tabela pública é exposta via
-- REST por padrão) — inclusive apagar as linhas "ativas" e destravar
-- a duplicidade que este lote inteiro existe pra impedir. Manter RLS
-- ligado com zero políticas + a trigger em SECURITY DEFINER é
-- estritamente mais seguro: ninguém além da própria trigger toca na
-- tabela, de nenhum jeito.
--
-- TESTADO localmente antes deste relatório: com o mesmo papel sem
-- privilégio especial que falhava antes, o INSERT em ordens_servico
-- passou a funcionar normalmente depois desta troca, a linha foi
-- gravada corretamente em ordem_itens, a restrição de duplicidade
-- continuou funcionando (2ª ordem pro mesmo conteúdo ainda é
-- recusada), e o mesmo papel sem privilégio especial CONTINUA sem
-- conseguir ler nem escrever em ordem_itens diretamente — só o
-- caminho automático (a trigger) tem acesso.
--
-- Ainda não sei se ordens_servico/conteudos seguem exatamente este
-- mesmo padrão (RLS ativo, papel específico com bypass) — pedi a
-- verificação no lote1-passo2-verificacao-rls.sql. Esta correção
-- funciona independentemente da resposta, porque só depende de quem
-- é DONO da função e da tabela ordem_itens (normalmente "postgres"
-- no Supabase) — mas prefiro que você rode o passo 2 e me mande o
-- resultado antes de aplicar este passo 3, caso ele revele algo
-- específico deste projeto que eu deva levar em conta.
-- ============================================================

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

-- Confirma que a função ficou dona de um papel que ignora RLS
-- (normalmente "postgres" — se aparecer outro nome aqui, me avise
-- antes de considerar isto resolvido):
-- SELECT p.proname, r.rolname AS dono, r.rolbypassrls AS ignora_rls
-- FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
-- WHERE p.proname = 'sync_ordem_itens';
