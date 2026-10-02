-- ads_metricas: retrato diário da conta de anúncios do cliente (Agente de Tráfego — fase 1, só
-- leitura, 02/out/2026). Uma linha por cliente por dia, gravada pelo cron (?job=ads, chave de
-- serviço). dados = saída de coletarConta() em api/_ads-lib.js (conta, resumo_7d, campanhas,
-- anúncios, problemas); alertas = o que detectarAlertas() achou naquele dia.
-- O cliente vê as dele; supervisor vê as dos seus clientes; admin vê todas. Ninguém grava pelo
-- navegador — só o servidor.
create table if not exists public.ads_metricas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data_coleta date not null,
  ad_account_id text not null,
  dados jsonb not null default '{}'::jsonb,
  alertas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, data_coleta)
);
create index if not exists ads_metricas_user_data_idx on public.ads_metricas (user_id, data_coleta desc);
alter table public.ads_metricas enable row level security;
create policy ads_metricas_sel on public.ads_metricas for select
  using (user_id = auth.uid() or public.is_supervisor_of(user_id) or public.is_admin());
