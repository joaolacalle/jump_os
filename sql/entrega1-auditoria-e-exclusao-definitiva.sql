-- ============================================================
-- ENTREGA 1 — AUDITORIA REAL + SUPERVISOR NÃO EXCLUI DEFINITIVO +
-- ADMIN BLOQUEADO SEM ACESSO
-- ============================================================
-- Ordem "Entrega 1 — Auditoria real + supervisor não exclui definitivo + admin bloqueado sem
-- acesso" (29/set/2026).
--
-- NÃO RODAR AUTOMATICAMENTE — este arquivo é aplicado manualmente pelo revisor, depois de
-- conferir. api/admin-users.js já foi alterado para escrever nas colunas NOVAS (acao, papel,
-- alvo_id, dados, criado por auditar()) — antes deste arquivo rodar, toda escrita em `logs`
-- continua falhando em silêncio exatamente como falhava antes (colunas não existem), então a
-- ordem de aplicação é: 1) revisor sobe api/admin-users.js, 2) revisor roda este arquivo.
--
-- Verificado no banco (mcp Supabase, somente leitura, antes de escrever este arquivo):
--   logs        — 0 linhas. Colunas reais: id, user_id, tipo, descricao, dados, criado_em.
--                 Nenhuma coluna created_at/acao/papel/alvo_id existe hoje.
--   uploads_all — ALL, using (user_id = auth.uid() OR is_supervisor_of(user_id) OR is_admin()),
--                 with check (user_id = auth.uid()). Deixa supervisor/admin apagar (DELETE
--                 também é ALL) o arquivo de um cliente.
--   uploads_sel — SELECT, pode_acessar(user_id). Não é tocada aqui.
--   cc_del      — DELETE, (auth.uid() = user_id). Nem admin desconecta a conta Meta de um
--                 cliente no "ver como" hoje.
--   pode_acessar() — testa `role = 'admin'` cru, sem checar `bloqueado` (diferente de
--                 is_admin(), que já nega admin bloqueado).
--
-- O bloco abaixo aborta a transação inteira se a contagem de `logs` tiver mudado entre essa
-- checagem e a execução (a migration assume a tabela vazia para trocar as colunas sem perda).

BEGIN;

DO $$
DECLARE
  qtd int;
BEGIN
  SELECT count(*) INTO qtd FROM public.logs;
  IF qtd > 0 THEN
    RAISE EXCEPTION 'logs tem % linha(s) — abortado: esta migration assume a tabela vazia (verificado em produção antes de escrever este arquivo, 0 linhas). Revisar antes de aplicar — trocar as colunas agora perderia dados.', qtd;
  END IF;
END $$;

-- 1) logs: troca as colunas antigas (nunca usadas por nenhum código — tipo/descricao/criado_em)
--    pela estrutura que api/admin-users.js (auditar()) já escreve: acao, papel, alvo_id,
--    created_at. `id`, `user_id` (quem executou) e `dados` já existiam e continuam.
ALTER TABLE public.logs
  ADD COLUMN IF NOT EXISTS acao text,
  ADD COLUMN IF NOT EXISTS papel text,
  ADD COLUMN IF NOT EXISTS alvo_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.logs
  DROP COLUMN IF EXISTS tipo,
  DROP COLUMN IF EXISTS descricao,
  DROP COLUMN IF EXISTS criado_em;

-- 2) logs: só a chave de serviço grava (via auditar(), o único ponto de escrita em logs do
--    arquivo); ninguém apaga o próprio registro pelo navegador. logs_select (is_admin()) já
--    cobre a leitura do admin e não é tocada aqui.
DROP POLICY IF EXISTS "usuario ve seus logs" ON public.logs;

-- 3) pode_acessar(): troca o teste cru de role por is_admin() (que já nega admin bloqueado) —
--    mesmo padrão que is_admin()/is_supervisor_of() já usam. O resto da função (dono, supervisor
--    do alvo) fica igual.
CREATE OR REPLACE FUNCTION public.pode_acessar(alvo uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select
    alvo = auth.uid()
    or is_admin()
    or exists (select 1 from clientes where id = alvo and supervisor_id = auth.uid());
$function$;

-- 4) uploads: substitui a policy ALL (que deixava supervisor/admin apagar o arquivo de um
--    cliente) por 3 policies separadas — mesmo efeito de hoje para INSERT/UPDATE, exclusão
--    restrita ao dono ou ao admin. uploads_sel (SELECT, pode_acessar(user_id)) não é tocada.
DROP POLICY IF EXISTS "uploads_all" ON public.uploads;

CREATE POLICY "uploads_ins" ON public.uploads
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "uploads_upd" ON public.uploads
  FOR UPDATE
  USING (user_id = auth.uid() OR is_supervisor_of(user_id) OR is_admin())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "uploads_del" ON public.uploads
  FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

-- 5) contas_conectadas: cc_del passa a aceitar o admin também — hoje só o dono desconecta, nem
--    o admin consegue no "ver como". A policy legada "usuario ve suas contas" (ALL, só dono)
--    continua existindo e não é alterada aqui: políticas permissivas se combinam por OR, então
--    ela não bloqueia o admin — cc_del libera o caso que faltava.
--    NOTA para quem for aplicar: sql/meta-oauth-autenticado-passo1-cc-del.sql (rodada anterior,
--    ainda não aplicada) recria cc_del como (dono OR supervisor OR admin) — esta ordem decidiu
--    diferente (supervisor NÃO desconecta conta Meta de cliente, só admin). Se as duas forem
--    aplicadas, aplique esta DEPOIS: o resultado final tem que ser (dono OR admin), sem
--    supervisor, que é o que este arquivo grava.
DROP POLICY IF EXISTS "cc_del" ON public.contas_conectadas;
CREATE POLICY "cc_del" ON public.contas_conectadas
  FOR DELETE
  USING (user_id = auth.uid() OR is_admin());

COMMIT;
