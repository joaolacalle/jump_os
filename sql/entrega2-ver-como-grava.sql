-- ============================================================================
-- Entrega 2 — "Ver como" grava de verdade + auditoria automática no banco
-- 29/set/2026 · aplicar manualmente no SQL Editor do Supabase (NÃO rodar sozinho
-- em produção sem revisão — é o revisor quem aplica, conforme a ordem).
--
-- O que este arquivo faz, em uma única transação:
--   1) Acrescenta políticas RLS de "escopo" (dono OU supervisor do dono OU admin)
--      em conteudos/ordens_servico/chat_mensagens/uploads/automacoes_dm/clientes,
--      SEM remover nenhuma política de dono já existente — só adiciona permissão,
--      nunca subtrai (políticas do Postgres são permissivas por padrão: viram OR).
--   2) Cria uma função + trigger únicos de auditoria automática, disparados em
--      TODAS as tabelas acima (mais contas_conectadas), que gravam em `logs`
--      sempre que quem executou (auth.uid()) é diferente do dono da linha —
--      sem depender de nenhuma página lembrar de chamar auditar().
--
-- NÃO TOCA: a trigger trg_clientes_protege_colunas (continua limitando as
-- colunas que o navegador pode mudar em `clientes`, independente de quem está
-- editando); nenhuma política de dono já existente; uploads_del; cc_del;
-- qualquer política de SELECT.
-- ============================================================================

BEGIN;

-- ── 1) conteudos ────────────────────────────────────────────────────────────
-- Hoje só existem: "usuario ve seus conteudos" (ALL, dono), cont_ins (INSERT,
-- dono), cont_sel (SELECT, pode_acessar), cont_gestao (SELECT, escopo já
-- existe), cont_upd (UPDATE, dono só). NÃO existe nenhuma política de DELETE.
create policy cont_ins_gestao on public.conteudos
  for insert
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

create policy cont_upd_gestao on public.conteudos
  for update
  using (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin())
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

create policy cont_del_gestao on public.conteudos
  for delete
  using (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

-- ── 2) ordens_servico ───────────────────────────────────────────────────────
-- Hoje existem os_ins/os_ins_own (INSERT, dono, duplicadas), os_sel/os_sel_own
-- (SELECT, já cobrem escopo de leitura), os_upd/os_upd_own (UPDATE, dono só,
-- duplicadas), os_del_own (DELETE, dono só). Não removo as duplicadas — fora
-- de escopo desta ordem, e o próprio texto pede "sem remover nenhuma política
-- existente de dono". Só acrescento o que falta: escopo de gestão em INSERT/
-- UPDATE/DELETE.
create policy os_ins_gestao on public.ordens_servico
  for insert
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

create policy os_upd_gestao on public.ordens_servico
  for update
  using (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin())
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

create policy os_del_gestao on public.ordens_servico
  for delete
  using (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

-- ── 3) chat_mensagens ────────────────────────────────────────────────────────
-- Só precisa de INSERT com escopo — não há UPDATE/DELETE de mensagem de chat
-- em lugar nenhum do produto hoje, e a ordem não pede.
create policy chat_ins_gestao on public.chat_mensagens
  for insert
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

-- ── 4) uploads ───────────────────────────────────────────────────────────────
-- uploads_ins hoje só aceita o próprio dono — falta escopo de gestão.
create policy uploads_ins_gestao on public.uploads
  for insert
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

-- uploads_upd JÁ tem escopo no USING (dono OU supervisor OU admin), mas o
-- WITH CHECK ficou só "user_id = auth.uid()" — herdado de uma versão anterior
-- da política, antes de o USING ganhar escopo. Isso quebra hoje: um supervisor
-- passa o filtro USING (pode alcançar a linha), mas a atualização é rejeitada
-- pelo WITH CHECK porque o user_id da linha (do cliente) nunca é igual ao
-- auth.uid() de quem está editando (o supervisor). Alinhando o WITH CHECK ao
-- USING, exatamente como a ordem pediu ("uploads_upd passa a ter check escopo").
alter policy uploads_upd on public.uploads
  using (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin())
  with check (user_id = auth.uid() or is_supervisor_of(user_id) or is_admin());

-- uploads_del NÃO muda (supervisor continua sem excluir arquivo de cliente —
-- decisão já tomada na "Entrega 1", 29/set/2026: exclusão definitiva é coisa
-- de admin).

-- ── 5) automacoes_dm ─────────────────────────────────────────────────────────
-- dm_own_ins/dm_own_sel/dm_own_upd já aceitam is_supervisor_of(user_id) desde
-- que a tabela foi criada — só a DELETE (dm_own_del) ficou de fora, aceitando
-- só dono ou admin (role='admin' bruto, sem nem checar bloqueado — pré-
-- existente, fora do escopo desta ordem, não corrigido aqui). Alinhando à
-- mesma regra das outras 3 políticas da tabela, como a ordem pediu.
alter policy dm_own_del on public.automacoes_dm
  using (
    user_id = auth.uid()
    or is_supervisor_of(user_id)
    or exists (select 1 from clientes where clientes.id = auth.uid() and clientes.role = 'admin')
  );

-- ── 6) clientes ──────────────────────────────────────────────────────────────
-- Nova política de UPDATE por gestão, ADICIONAL à clientes_update_self (dono
-- só) já existente — nenhuma delas é removida. A trigger
-- trg_clientes_protege_colunas continua rodando por igual em qualquer UPDATE,
-- então mesmo com esta política nova, só nome/telefone/whatsapp/endereco/
-- tema/onboarding/preferencias podem ser alterados pelo navegador — o resto
-- (plano, limites, bloqueado, protegido, cpf...) continua travado, com ou sem
-- "ver como".
create policy clientes_update_gestao on public.clientes
  for update
  using (id = auth.uid() or is_supervisor_of(id) or is_admin())
  with check (id = auth.uid() or is_supervisor_of(id) or is_admin());

-- ============================================================================
-- 7) Auditoria automática por trigger — grava em `logs` sempre que quem
--    executou a escrita (auth.uid()) é diferente do dono da linha afetada.
--    Nunca grava o CONTEÚDO de nenhuma coluna — só nomes de campos e ids.
--    Chave de serviço (auth.uid() nulo, usada pelas rotas de api/*) nunca gera
--    registro aqui — o servidor já audita essas ações pela função auditar()
--    em api/admin-users.js (rodada "Entrega 1"); duplicar geraria 2 linhas por
--    ação nas rotas de servidor.
-- ============================================================================
create or replace function public.auditar_gestao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ator uuid := auth.uid();
  dono uuid;
  registro_id uuid;
  papel_ator text;
  campos text[];
begin
  if ator is null then
    return coalesce(new, old);
  end if;

  if TG_TABLE_NAME = 'clientes' then
    dono := coalesce(new.id, old.id);
    registro_id := dono;
  else
    dono := coalesce(new.user_id, old.user_id);
    registro_id := coalesce(new.id, old.id);
  end if;

  if dono is null or dono = ator then
    return coalesce(new, old);
  end if;

  begin
    select role into papel_ator from clientes where id = ator;

    if TG_OP = 'UPDATE' then
      select array_agg(k) into campos
      from jsonb_each(to_jsonb(new)) as j(k, v)
      where (to_jsonb(old) -> j.k) is distinct from (to_jsonb(new) -> j.k);
    else
      campos := null;
    end if;

    insert into logs (user_id, papel, acao, alvo_id, dados)
    values (
      ator,
      coalesce(papel_ator, 'desconhecido'),
      TG_TABLE_NAME || ':' || lower(TG_OP),
      dono,
      jsonb_build_object(
        'registro_id', registro_id,
        'campos_alterados', to_jsonb(coalesce(campos, array[]::text[]))
      )
    );
  exception when others then
    -- nunca deixa a auditoria travar a operação real, só avisa no log do servidor
    raise warning 'auditar_gestao: falha ao gravar log (tabela %, ator %): %', TG_TABLE_NAME, ator, SQLERRM;
  end;

  return coalesce(new, old);
end;
$$;

create trigger trg_auditoria_gestao_conteudos
  after insert or update or delete on public.conteudos
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_ordens_servico
  after insert or update or delete on public.ordens_servico
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_chat_mensagens
  after insert or update or delete on public.chat_mensagens
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_uploads
  after insert or update or delete on public.uploads
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_automacoes_dm
  after insert or update or delete on public.automacoes_dm
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_clientes
  after insert or update or delete on public.clientes
  for each row execute function public.auditar_gestao();

create trigger trg_auditoria_gestao_contas_conectadas
  after insert or update or delete on public.contas_conectadas
  for each row execute function public.auditar_gestao();

COMMIT;

-- ============================================================================
-- NOTA — checagem de colisão com trg_sync_ordem_itens (ordens_servico), pedida
-- explicitamente pela ordem ("## Se divergir"): trg_sync_ordem_itens só lê/
-- escreve a tabela ordem_itens a partir de NEW.payload; trg_auditoria_gestao_
-- ordens_servico só lê NEW/OLD (sem alterá-los) e escreve em `logs`. As duas
-- são AFTER INSERT/UPDATE na mesma tabela, mas não leem a saída uma da outra
-- nem tocam a mesma tabela-alvo — não há conflito de ordem de disparo possível
-- aqui. Confirmado antes de aplicar, não depois.
-- ============================================================================
