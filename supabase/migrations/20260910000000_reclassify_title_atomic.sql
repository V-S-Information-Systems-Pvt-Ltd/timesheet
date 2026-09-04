-- supabase/migrations/20260910000000_reclassify_title_atomic.sql
-- Atomic title reclassification RPC

create or replace function public.reclassify_title_atomic(
  p_title text,
  p_hierarchy_role text,
  p_sync_users boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affected_count integer;
  v_clean text := trim(p_title);
begin
  if v_clean is null or length(v_clean) = 0 then
    raise exception 'Title name is required.';
  end if;

  if p_hierarchy_role is null or p_hierarchy_role not in ('manager', 'team_lead', 'engineer', 'user') then
    raise exception 'Invalid hierarchy role "%".', p_hierarchy_role;
  end if;

  -- Verify title exists and lock
  perform 1 from public.titles where lower(name) = lower(v_clean) for update;
  if not found then
    raise exception 'Title "%" not found.', v_clean;
  end if;

  -- Count matching profiles
  select count(*) into v_affected_count
  from public.profiles
  where lower(title) = lower(v_clean);

  -- Update title table
  update public.titles
  set hierarchy_role = p_hierarchy_role
  where lower(name) = lower(v_clean);

  -- Sync matching profiles if requested
  if p_sync_users and v_affected_count > 0 then
    update public.profiles
    set hierarchy_role = p_hierarchy_role
    where lower(title) = lower(v_clean);
  end if;

  return v_affected_count;
end;
$$;

revoke all on function public.reclassify_title_atomic(text, text, boolean) from public, anon, authenticated;
grant execute on function public.reclassify_title_atomic(text, text, boolean) to service_role;
