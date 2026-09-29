-- ============================================================
-- AUTENTICAR O INÍCIO DA CONEXÃO META — PASSO 1: POLÍTICA DE DELETE
-- ============================================================
-- Ordem "Autenticar o início da conexão Meta e respeitar o modo de visualização" (28/set/2026).
--
-- api/meta-oauth.js passou a exigir Authorization: Bearer <jwt> e a aceitar `alvo` só quando
-- clientes.role de quem chamou for admin/supervisor — mesmo padrão que a política de SELECT
-- desta tabela (cc_gestao) já usa hoje. conectar-conta.html passou a listar/conectar/desconectar
-- pelo alvo da visualização (CTX.viewId||CTX.user.id, sob ?ver=), não mais sempre CTX.user.id.
--
-- Sem este passo, admin/supervisor sob ?ver= continua vendo a conexão (cc_gestao já cobre
-- SELECT) mas o botão "Desconectar" falha em silêncio: a política de DELETE (cc_del) só permite
-- auth.uid() = user_id, isto é, só o próprio dono da conta apaga a própria conexão. Foi o que fez
-- a conta de teste cair no login errado três vezes.
--
-- Verificado no banco (mcp Supabase, somente leitura, antes de escrever esta migration):
--   cc_del   DELETE  (auth.uid() = user_id)
--   cc_gestao SELECT (user_id = auth.uid() OR is_supervisor_of(user_id) OR is_admin())
--   cc_sel   SELECT  (auth.uid() = user_id)
--   "usuario ve suas contas" ALL (auth.uid() = user_id)  -- pré-existente, já cobre o dono; não
--     precisa mexer: RLS aceita a linha se QUALQUER política permissiva do comando autorizar.
--
-- Só a política de DELETE muda, para o mesmo padrão de cc_gestao (mesmas funções
-- is_supervisor_of()/is_admin(), não uma cópia da regra). Nenhuma política de SELECT é tocada —
-- não amplia quem ENXERGA as linhas, só quem pode apagar.

BEGIN;

DROP POLICY IF EXISTS cc_del ON contas_conectadas;
CREATE POLICY cc_del ON contas_conectadas FOR DELETE
  USING (user_id = auth.uid() OR is_supervisor_of(user_id) OR is_admin());

COMMIT;
