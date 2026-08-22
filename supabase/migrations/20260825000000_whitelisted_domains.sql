-- supabase/migrations/20260825000000_whitelisted_domains.sql
-- Email domain whitelist with auto-activation option and handle_new_user trigger integration.

create table if not exists public.whitelisted_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  auto_activate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_whitelisted_domains_domain on public.whitelisted_domains (domain);

alter table public.whitelisted_domains enable row level security;

create policy "whitelisted_domains_select_authenticated" on public.whitelisted_domains
  for select to authenticated
  using (true);

create policy "whitelisted_domains_admin_all" on public.whitelisted_domains
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

-- Update handle_new_user trigger to respect domain auto_activate
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_domain text;
  domain_auto boolean;
  domain_found boolean := false;
begin
  user_domain := lower(split_part(new.email, '@', 2));
  select auto_activate into domain_auto
  from public.whitelisted_domains
  where lower(domain) = user_domain
  limit 1;

  if found then
    domain_found := true;
  end if;

  insert into public.profiles (id, email, name, is_active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), ''),
    case when domain_found and domain_auto then true else false end
  );
  return new;
end;
$$;
