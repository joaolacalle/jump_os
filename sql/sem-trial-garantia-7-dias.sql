-- SEM TESTE GRÁTIS (03/out/2026, decisão do João): a conta nasce sem trial quando
-- config.trial.dias = 0 (cobrança no dia 1; vale a garantia de 7 dias do CDC art. 49, com metade
-- da cota liberada até o 8º dia — assets/classificacao.js:emGarantia). Com dias > 0 o
-- comportamento antigo (trial a partir do cadastro) volta sem mexer no código.
-- Aplicada no Supabase como migration "sem_trial_garantia_7_dias".
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  v_dias int := 0;
begin
  begin
    select coalesce(nullif(valor->>'dias','')::int, 0) into v_dias from public.config where chave='trial' limit 1;
  exception when others then v_dias := 0;
  end;
  if v_dias is null or v_dias < 0 then v_dias := 0; end if;
  begin
    insert into clientes (id, email, nome, role, status, plano, tipo_cortesia, cortesia_ate)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
      'usuario',
      'pendente',
      coalesce(new.raw_user_meta_data->>'plano','basico'),
      case when v_dias > 0 then 'trial' else null end,
      case when v_dias > 0 then now() + make_interval(days => v_dias) else null end
    )
    on conflict (id) do nothing;
  exception when others then
    -- nunca derruba a criação do usuário no Auth
    null;
  end;
  return new;
end $function$;

update public.config set valor = jsonb_set(valor, '{dias}', '0'::jsonb) where chave = 'trial';
