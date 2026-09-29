-- ============================================================================
-- Entrega 2 — teste da migration sql/entrega2-ver-como-grava.sql
-- 29/set/2026 · BEGIN...ROLLBACK — não deixa nenhum dado de teste no banco.
--
-- Como rodar: aplicar primeiro entrega2-ver-como-grava.sql (ou, se preferir
-- testar antes de aplicar de verdade, colar o corpo das duas migrations numa
-- única transação de teste — este arquivo por si só assume que a migration
-- já rodou, já que só testa o resultado dela). Executar o arquivo inteiro de
-- uma vez; o SELECT final lista PASSOU/FALHOU por caso; a transação sempre
-- termina em ROLLBACK, então nenhuma linha de teste fica em clientes/
-- conteudos/auth.users/etc. nem em `logs`.
--
-- Fixture (uuids fixos só para este teste, dentro da transação):
--   adm1  aaaaaaaa-0000-0000-0000-000000000001  admin
--   sup1  aaaaaaaa-0000-0000-0000-000000000002  supervisor (de cli1)
--   sup2  aaaaaaaa-0000-0000-0000-000000000003  supervisor (de NENHUM cliente
--         deste teste — usado para provar que escopo não vaza entre supervisores)
--   cli1  aaaaaaaa-0000-0000-0000-000000000004  usuario, supervisor_id=sup1
--
-- `conteudos.user_id` tem FK para auth.users (as demais tabelas tocadas por
-- esta migration não têm) — por isso o fixture cria também 4 linhas mínimas
-- em auth.users, só dentro desta transação. A ordem importa: `clientes` é
-- inserido PRIMEIRO (não tem FK para auth.users) para fixar role/
-- supervisor_id como este teste precisa; `auth.users` é inserido DEPOIS — a
-- trigger handle_new_user tentaria criar uma linha própria em `clientes` a
-- partir daí, mas ela usa "on conflict (id) do nothing", então não sobrescreve
-- os dados que este teste já gravou.
--
-- Checagem de auditoria: em vez de comparar count(*) de `logs` antes/depois
-- (banco de produção, com tráfego real e concorrente — o número global pode
-- mudar por ação de outro usuário no meio do teste, dando falso positivo ou
-- negativo), cada checagem procura uma linha ESPECÍFICA por (user_id=ator,
-- alvo_id=dono, acao) — como ator/dono aqui são os uuids fictícios deste
-- fixture, qualquer linha que bata com eles só pode ter sido criada por este
-- teste, dentro desta transação.
-- ============================================================================

BEGIN;

-- tabela de resultados — criada e usada como postgres (superuser), depois
-- liberada para o role authenticated escrever durante os testes
create temp table test_resultados(
  ordem serial primary key,
  caso text,
  esperado text,
  ocorreu text,
  ok boolean
);
grant select, insert on test_resultados to authenticated;
grant usage, select on test_resultados_ordem_seq to authenticated;

-- fixture: 1 admin, 2 supervisores, 1 cliente do sup1 (em `clientes`, sem FK)
insert into clientes (id, nome, email, role, supervisor_id, plano, status, limites, uso, preferencias)
values
  ('aaaaaaaa-0000-0000-0000-000000000001','Admin Teste','adm1.teste@jump.local','admin',null,null,null,'{}','{}','{}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Supervisor 1 Teste','sup1.teste@jump.local','supervisor',null,null,null,'{}','{}','{}'),
  ('aaaaaaaa-0000-0000-0000-000000000003','Supervisor 2 Teste','sup2.teste@jump.local','supervisor',null,null,null,'{}','{}','{}'),
  ('aaaaaaaa-0000-0000-0000-000000000004','Cliente 1 Teste','cli1.teste@jump.local','usuario','aaaaaaaa-0000-0000-0000-000000000002','basico','ativo','{}','{}','{}');

-- mesmos 4 ids em auth.users, só para satisfazer a FK de conteudos.user_id
insert into auth.users (id, email)
values
  ('aaaaaaaa-0000-0000-0000-000000000001','adm1.teste@jump.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002','sup1.teste@jump.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003','sup2.teste@jump.local'),
  ('aaaaaaaa-0000-0000-0000-000000000004','cli1.teste@jump.local');

-- ============================================================================
-- CASO 1 — supervisor do cliente grava (conteudos INSERT) — deve funcionar
-- ============================================================================
do $$
declare novo_id uuid; audita boolean;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into conteudos (user_id, tema, status, formato)
    values ('aaaaaaaa-0000-0000-0000-000000000004','post de teste','rascunho','feed')
    returning id into novo_id;
    perform set_config('jump.novo_conteudo_id', novo_id::text, false);
    -- `logs_select` só permite is_admin() — sup1 não veria a própria linha
    -- que a trigger acabou de gravar; volta ao role de conexão (sem RLS)
    -- só para CONFERIR o log, depois de já ter feito a escrita como sup1.
    execute 'reset role';
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000002'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='conteudos:insert'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 1: supervisor do cliente insere em conteudos (escopo novo)',
      'sucesso + linha em logs (conteudos:insert)', 'sucesso, auditou='||audita,
      audita
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 1: supervisor do cliente insere em conteudos (escopo novo)',
      'sucesso + linha em logs (conteudos:insert)', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 2 — supervisor de OUTRO cliente é barrado (conteudos INSERT)
-- ============================================================================
do $$
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000003');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into conteudos (user_id, tema, status, formato)
    values ('aaaaaaaa-0000-0000-0000-000000000004','tentativa indevida','rascunho','feed');
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 2: supervisor de OUTRO cliente tenta inserir em conteudos',
      'bloqueado (RLS)', 'NÃO foi bloqueado — inseriu mesmo assim', false
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 2: supervisor de OUTRO cliente tenta inserir em conteudos',
      'bloqueado (RLS)', 'bloqueado: '||SQLERRM,
      SQLERRM ilike '%row-level security%' or SQLERRM ilike '%policy%'
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 3 — admin atualiza o conteúdo do cliente (conteudos UPDATE) + auditoria
-- ============================================================================
do $$
declare alvo uuid; audita boolean;
begin
  select current_setting('jump.novo_conteudo_id', true)::uuid into alvo;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000001');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    update conteudos set status='aprovado' where id=alvo;
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000001'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='conteudos:update'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 3: admin atualiza conteudo do cliente (escopo novo) + audita',
      'sucesso + linha em logs (conteudos:update)', 'sucesso, auditou='||audita,
      audita
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 3: admin atualiza conteudo do cliente (escopo novo) + audita',
      'sucesso + linha em logs (conteudos:update)', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 4 — supervisor exclui o conteúdo do cliente (conteudos DELETE, política
-- nova — hoje não existia NENHUMA política de DELETE nesta tabela)
-- ============================================================================
do $$
declare alvo uuid; qtd_del int; audita boolean;
begin
  select current_setting('jump.novo_conteudo_id', true)::uuid into alvo;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    delete from conteudos where id=alvo;
    get diagnostics qtd_del = row_count;
    -- idem CASO 1: sai do role authenticated antes de checar `logs`
    execute 'reset role';
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000002'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='conteudos:delete'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 4: supervisor exclui conteudo do cliente (DELETE novo) + audita',
      '1 linha excluída + linha em logs (conteudos:delete)', 'excluiu '||qtd_del||', auditou='||audita,
      qtd_del = 1 and audita
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 4: supervisor exclui conteudo do cliente (DELETE novo) + audita',
      '1 linha excluída + linha em logs (conteudos:delete)', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 5 — supervisor cria ordem_servico em nome do cliente (INSERT novo)
-- ============================================================================
do $$
declare audita boolean;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into ordens_servico (user_id, de_agente, para_agente, tarefa, status)
    values ('aaaaaaaa-0000-0000-0000-000000000004','supervisor','usuario','tarefa_teste','pendente');
    -- idem CASO 1: sai do role authenticated antes de checar `logs`
    execute 'reset role';
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000002'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='ordens_servico:insert'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 5: supervisor cria ordem_servico do cliente (escopo novo) + audita',
      'sucesso + linha em logs (ordens_servico:insert)', 'sucesso, auditou='||audita,
      audita
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 5: supervisor cria ordem_servico do cliente (escopo novo) + audita',
      'sucesso + linha em logs (ordens_servico:insert)', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 6 — supervisor cancela (UPDATE de status) a ordem que acabou de criar
-- ============================================================================
do $$
declare qtd_ok int;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    update ordens_servico set status='concluida' where user_id='aaaaaaaa-0000-0000-0000-000000000004' and tarefa='tarefa_teste';
    get diagnostics qtd_ok = row_count;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 6: supervisor atualiza ordens_servico do cliente (UPDATE escopo novo)',
      '1 linha atualizada', qtd_ok||' linha(s) atualizada(s)', qtd_ok=1
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 6: supervisor atualiza ordens_servico do cliente (UPDATE escopo novo)',
      '1 linha atualizada', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 7 — supervisor manda mensagem de chat em nome do cliente (INSERT novo)
-- ============================================================================
do $$
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into chat_mensagens (user_id, agente, role, conteudo)
    values ('aaaaaaaa-0000-0000-0000-000000000004','estrategia','user','mensagem de teste');
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 7: supervisor insere chat_mensagens em nome do cliente (escopo novo)',
      'sucesso', 'sucesso', true
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 7: supervisor insere chat_mensagens em nome do cliente (escopo novo)',
      'sucesso', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 8 — supervisor faz upload em nome do cliente (INSERT novo) e depois
-- ATUALIZA esse upload (UPDATE — o with check estava quebrado, ver migration)
-- ============================================================================
do $$
declare novo_id uuid;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into uploads (user_id, categoria, nome, url)
    values ('aaaaaaaa-0000-0000-0000-000000000004','videos','arquivo-teste.mp4','https://exemplo.local/arquivo-teste.mp4')
    returning id into novo_id;
    perform set_config('jump.novo_upload_id', novo_id::text, false);
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 8a: supervisor insere upload em nome do cliente (escopo novo)',
      'sucesso', 'sucesso', true
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 8a: supervisor insere upload em nome do cliente (escopo novo)',
      'sucesso', 'ERRO: '||SQLERRM, false
    );
  end;
  begin
    update uploads set nome='arquivo-teste-renomeado.mp4'
    where id = current_setting('jump.novo_upload_id', true)::uuid;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 8b: supervisor ATUALIZA upload do cliente (with check corrigido)',
      'sucesso', 'sucesso', true
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 8b: supervisor ATUALIZA upload do cliente (with check corrigido)',
      'sucesso', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 9 — supervisor NÃO PODE excluir o upload do cliente (uploads_del não
-- muda — mesma decisão da Entrega 1)
-- ============================================================================
do $$
declare qtd_del int;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    delete from uploads where id = current_setting('jump.novo_upload_id', true)::uuid;
    get diagnostics qtd_del = row_count;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 9: supervisor tenta excluir upload do cliente (deve continuar bloqueado)',
      '0 linhas excluídas (RLS bloqueia silenciosamente, sem erro)', qtd_del||' linha(s) excluída(s)',
      qtd_del = 0
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 9: supervisor tenta excluir upload do cliente (deve continuar bloqueado)',
      '0 linhas excluídas (RLS bloqueia silenciosamente, sem erro)', 'bloqueado com erro: '||SQLERRM,
      true
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 10 — supervisor exclui a automação de DM do cliente (DELETE — política
-- alterada nesta migration para aceitar is_supervisor_of)
-- ============================================================================
do $$
declare novo_id uuid; qtd_del int;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into automacoes_dm (user_id, palavra_chave, mensagem)
    values ('aaaaaaaa-0000-0000-0000-000000000004','promo','mensagem automática de teste')
    returning id into novo_id;
    delete from automacoes_dm where id = novo_id;
    get diagnostics qtd_del = row_count;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 10: supervisor exclui automacoes_dm do cliente (DELETE corrigido)',
      '1 linha excluída', qtd_del||' linha(s) excluída(s)', qtd_del = 1
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 10: supervisor exclui automacoes_dm do cliente (DELETE corrigido)',
      '1 linha excluída', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 11 — supervisor atualiza clientes.preferencias do cliente (UPDATE
-- novo em clientes) + trigger protege_colunas continua valendo
-- ============================================================================
do $$
declare audita boolean;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    update clientes set preferencias='{"dia_lote":3}'::jsonb where id='aaaaaaaa-0000-0000-0000-000000000004';
    -- `logs_select` só permite is_admin() — sup1 não veria a própria linha
    -- que a trigger acabou de gravar; sai do role authenticated só para
    -- CONFERIR o log (a escrita em si já foi feita como sup1, antes disso).
    execute 'reset role';
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000002'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='clientes:update'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 11a: supervisor atualiza clientes.preferencias do cliente (coluna permitida)',
      'sucesso + linha em logs (clientes:update)', 'sucesso, auditou='||audita,
      audita
    );
  exception when others then
    execute 'reset role';
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 11a: supervisor atualiza clientes.preferencias do cliente (coluna permitida)',
      'sucesso + linha em logs (clientes:update)', 'ERRO: '||SQLERRM, false
    );
  end;
  -- volta a agir como sup1 para o CASO 11b (a checagem acima saiu do role)
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000002');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    update clientes set plano='pro' where id='aaaaaaaa-0000-0000-0000-000000000004';
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 11b: supervisor tenta mudar clientes.plano do cliente (coluna NÃO permitida)',
      'bloqueado pela trigger protege_colunas', 'NÃO foi bloqueado — mudou mesmo assim', false
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 11b: supervisor tenta mudar clientes.plano do cliente (coluna NÃO permitida)',
      'bloqueado pela trigger protege_colunas', 'bloqueado: '||SQLERRM,
      SQLERRM ilike '%não permitida%' or SQLERRM ilike '%42501%' or SQLERRM ilike '%servidor%'
    );
  end;
end $$;
reset role;

-- ============================================================================
-- CASO 12 — contas_conectadas: esta tabela NÃO teve nenhuma política de RLS
-- alterada (a ordem só pede a auditoria nova, sem mudar quem pode excluir —
-- supervisor continua sem poder desconectar a conta Meta de um cliente,
-- decisão da "Entrega 1"). contas_conectadas.user_id também tem FK para
-- auth.users, então este caso é verificado por CATÁLOGO (metadados do
-- Postgres) em vez de uma escrita de verdade: (a) a condição da política
-- cc_del continua exatamente a mesma de antes desta migration (sem
-- is_supervisor_of), (b) a trigger de auditoria nova existe e está ativa
-- nesta tabela.
-- ============================================================================
do $$
declare qual_atual text;
begin
  select pg_get_expr(polqual, polrelid) into qual_atual
  from pg_policy where polname='cc_del' and polrelid='public.contas_conectadas'::regclass;
  insert into test_resultados(caso,esperado,ocorreu,ok) values(
    'CASO 12a: política cc_del NÃO foi alterada por esta migration (supervisor continua sem excluir)',
    'sem is_supervisor_of na condição', qual_atual,
    qual_atual not ilike '%is_supervisor_of%'
  );
exception when others then
  insert into test_resultados(caso,esperado,ocorreu,ok) values(
    'CASO 12a: política cc_del NÃO foi alterada por esta migration (supervisor continua sem excluir)',
    'sem is_supervisor_of na condição', 'ERRO: '||SQLERRM, false
  );
end $$;

do $$
declare existe boolean;
begin
  select exists(
    select 1 from pg_trigger
    where tgname='trg_auditoria_gestao_contas_conectadas'
      and tgrelid='public.contas_conectadas'::regclass
      and tgenabled <> 'D'
  ) into existe;
  insert into test_resultados(caso,esperado,ocorreu,ok) values(
    'CASO 12b: trigger de auditoria nova existe e está ativa em contas_conectadas',
    'true', existe::text, existe
  );
exception when others then
  insert into test_resultados(caso,esperado,ocorreu,ok) values(
    'CASO 12b: trigger de auditoria nova existe e está ativa em contas_conectadas',
    'true', 'ERRO: '||SQLERRM, false
  );
end $$;

-- ============================================================================
-- CASO 13 — o PRÓPRIO cliente grava na própria conta (nunca deveria mudar,
-- e NÃO deve gerar linha de auditoria — auditoria só quando ator≠dono)
-- ============================================================================
do $$
declare audita boolean;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claim.sub = %L', 'aaaaaaaa-0000-0000-0000-000000000004');
  execute 'set local request.jwt.claim.role = ''authenticated''';
  begin
    insert into conteudos (user_id, tema, status, formato)
    values ('aaaaaaaa-0000-0000-0000-000000000004','post do próprio cliente','rascunho','feed');
    -- idem CASO 1: sai do role authenticated para que a ausência de linha
    -- em `logs` seja uma prova real (RLS hoje escondia isso de qualquer
    -- jeito, então sem este reset a checagem "não auditou" seria falso
    -- positivo mesmo que a trigger tivesse um bug).
    execute 'reset role';
    select exists(
      select 1 from logs where user_id='aaaaaaaa-0000-0000-0000-000000000004'
        and alvo_id='aaaaaaaa-0000-0000-0000-000000000004' and acao='conteudos:insert'
    ) into audita;
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 13: o próprio cliente grava na própria conta (não deve auditar)',
      'sucesso + NENHUMA linha nova em logs', 'sucesso, auditou='||audita,
      not audita
    );
  exception when others then
    insert into test_resultados(caso,esperado,ocorreu,ok) values(
      'CASO 13: o próprio cliente grava na própria conta (não deve auditar)',
      'sucesso + NENHUMA linha nova em logs', 'ERRO: '||SQLERRM, false
    );
  end;
end $$;
reset role;

-- ============================================================================
-- relatório final — sempre visível mesmo em ROLLBACK, porque é lido ANTES do
-- ROLLBACK acontecer (na mesma execução do arquivo)
-- ============================================================================
select
  ordem, caso, esperado, ocorreu,
  case when ok then '✓ PASSOU' else '✗ FALHOU' end as resultado
from test_resultados
order by ordem;

select
  count(*) filter (where ok) as passou,
  count(*) filter (where not ok) as falhou,
  count(*) as total
from test_resultados;

ROLLBACK;
