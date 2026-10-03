-- Vínculo PERMANENTE perfil do Instagram → conta JUMP (03/out/2026).
-- A trava antiga só olhava contas_conectadas: se a pessoa desconectasse o Instagram ou excluísse
-- a conta, o @ ficava livre para outra conta (novo e-mail) e o uso grátis se repetia.
-- Esta tabela NÃO é apagada ao desconectar nem ao excluir a conta (sem FK para clientes/auth).
-- Liberação manual pelo suporte: preencher liberado_em (o próximo que conectar assume o vínculo).
-- Base legal (LGPD art. 7º, IX e art. 16, II): prevenção a fraude — guarda só ids, @ e e-mail.
create table if not exists public.instagram_vinculos (
  id uuid primary key default gen_random_uuid(),
  ig_id text,
  ig_app_id text,
  ig_username text,
  user_id uuid not null,
  email text,
  criado_em timestamptz not null default now(),
  liberado_em timestamptz,
  liberado_por text
);
create index if not exists instagram_vinculos_ig_id on public.instagram_vinculos (ig_id);
create index if not exists instagram_vinculos_ig_app_id on public.instagram_vinculos (ig_app_id);
alter table public.instagram_vinculos enable row level security; -- só o servidor (service role) lê/grava

insert into public.instagram_vinculos (ig_id, ig_app_id, ig_username, user_id, email)
select c.meta->>'ig_id', c.meta->>'ig_app_id', c.meta->>'ig_username', c.user_id, cl.email
from public.contas_conectadas c left join public.clientes cl on cl.id = c.user_id
where c.tipo = 'instagram'
  and not exists (select 1 from public.instagram_vinculos v where v.user_id = c.user_id
                  and (v.ig_id = c.meta->>'ig_id' or v.ig_app_id = c.meta->>'ig_app_id'));
