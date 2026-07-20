begin;

create or replace function public.get_workspace_usage_summary(p_workspace_id uuid)
returns table (
  plan text,
  period_ends_at timestamptz,
  daily_used integer,
  daily_limit integer,
  daily_remaining integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement public.entitlements%rowtype;
  policy public.usage_policies%rowtype;
  used_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  select * into entitlement from public.entitlements
  where workspace_id = p_workspace_id and status = 'active'
  order by starts_at desc limit 1;
  if not found then return; end if;

  select * into policy from public.usage_policies
  where usage_policies.plan = entitlement.plan and active limit 1;
  if not found then return; end if;

  select count(*) into used_count from public.execution_runs
  where workspace_id = p_workspace_id
    and created_at >= date_trunc('day', now())
    and status not in ('failed', 'canceled');

  return query select entitlement.plan, entitlement.ends_at, used_count,
    policy.max_daily_investigations,
    greatest(0, policy.max_daily_investigations - used_count);
end;
$$;

revoke all on function public.get_workspace_usage_summary(uuid) from public, anon;
grant execute on function public.get_workspace_usage_summary(uuid) to authenticated;

commit;
