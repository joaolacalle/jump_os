-- ============================================================
-- LOTE 1 — TRAVA DE DUPLICIDADE — PASSO 2: VERIFICAÇÃO DE RLS (só leitura)
-- ============================================================
-- Motivo: ordem_itens nasceu com RLS ativo e zero políticas (alerta do
-- João) — a trigger que a mantém era bloqueada ao tentar gravar, o que
-- derrubava a criação da ordem inteira. Antes de aplicar a correção
-- (lote1-passo3-fix-rls.sql), preciso saber como ordens_servico e
-- conteudos estão configuradas hoje, pra não inventar um padrão novo
-- por conta própria — pedido explícito do João.
--
-- Rode isto e cole o resultado das duas consultas na conversa.
-- 100% seguro: só lê metadados do catálogo do Postgres, não toca em
-- nenhuma linha de dado nem em nenhuma tabela do projeto.
-- ============================================================

-- 1) RLS está ligado em cada tabela? (relrowsecurity = true/false)
SELECT relname AS tabela, relrowsecurity AS rls_ativo, relforcerowsecurity AS rls_forcado_no_dono
FROM pg_class
WHERE relname IN ('ordens_servico','conteudos','ordem_itens')
  AND relnamespace = 'public'::regnamespace;

-- 2) Quais políticas existem em cada uma (vazio = RLS ativo mas sem
--    nenhuma política = bloqueio total, o mesmo problema que achamos
--    em ordem_itens)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('ordens_servico','conteudos')
ORDER BY tablename, policyname;
