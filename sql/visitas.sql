-- visitas: registro das visitas presenciais do supervisor ao cliente (30/set/2026).
-- Só o supervisor do cliente grava (sem supervisor, ninguém preenche). O cliente vê as dele;
-- o admin vê todas. dados = campos do roteiro (conversa, análise, conteúdos, captação, ações).
create table if not exists public.visitas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  supervisor_id uuid not null default auth.uid(),
  data date not null default current_date,
  status text not null default 'Visita concluída',
  proxima_data date,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visitas_cliente_data_idx on public.visitas (cliente_id, data desc);
alter table public.visitas enable row level security;
create policy visitas_sel on public.visitas for select
  using (cliente_id = auth.uid() or public.is_supervisor_of(cliente_id) or public.is_admin());
create policy visitas_ins on public.visitas for insert
  with check (public.is_supervisor_of(cliente_id) and supervisor_id = auth.uid());
create policy visitas_upd on public.visitas for update
  using (public.is_supervisor_of(cliente_id)) with check (public.is_supervisor_of(cliente_id));
create policy visitas_del on public.visitas for delete
  using (public.is_supervisor_of(cliente_id));
