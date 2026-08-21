-- supabase/migrations/20260824000000_audit_logs.sql
-- Immutable audit log for administrative, role, settings, and bulk operations.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null,
  action text not null,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_action on public.audit_logs (action);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

-- RLS: Only admins can view and write audit logs, and writes must identify
-- the authenticated actor rather than an arbitrary user.
alter table public.audit_logs enable row level security;

create policy "Admins can view audit logs"
  on public.audit_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can insert own audit logs"
  on public.audit_logs for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
    and actor_id = auth.uid()
    and actor_email = (
      select email from public.profiles where id = auth.uid()
    )
  );
