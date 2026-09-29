-- TESTE GRÁTIS DE 7 DIAS A PARTIR DO CADASTRO (29/set/2026, decisão do João: "7 dias após o
-- login"; garantia de compras digitais). Antes, o teste só começava quando o cliente assinava pelo
-- PayPal (api/paypal.js e api/webhook-paypal.js marcam cortesia_ate só "se ainda não existir") e a
-- conta nova nascia sem cortesia_ate. Agora a conta já nasce em teste: tipo_cortesia='trial',
-- cortesia_ate = cadastro + config.trial.dias (7 se a config faltar). Os dois pontos do PayPal
-- continuam iguais: como a data já existe, eles não reiniciam nem estendem o teste.
-- Aplicada no Supabase como migration "trial_7_dias_no_cadastro".
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  v_dias int := 7;
begin
  begin
    select coalesce(nullif(valor->>'dias','')::int, 7) into v_dias from public.config where chave='trial' limit 1;
  exception when others then v_dias := 7;
  end;
  if v_dias is null or v_dias < 1 then v_dias := 7; end if;
  begin
    insert into clientes (id, email, nome, role, status, plano, tipo_cortesia, cortesia_ate)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
      'usuario',
      'pendente',
      coalesce(new.raw_user_meta_data->>'plano','basico'),
      'trial',
      now() + make_interval(days => v_dias)
    )
    on conflict (id) do nothing;
  exception when others then
    -- nunca derruba a criação do usuário no Auth
    null;
  end;
  return new;
end $function$;
