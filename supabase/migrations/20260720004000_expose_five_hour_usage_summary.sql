begin;

drop function if exists public.get_workspace_usage_summary(uuid);

create function public.get_workspace_usage_summary(p_workspace_id uuid)
returns table (
  plan text,
  trial_ends_at timestamptz,
  window_started_at timestamptz,
  window_ends_at timestamptz,
  usage_percentage numeric,
  warning_percentage numeric,
  usage_status text,
  enforcement_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement public.entitlements%rowtype;
  policy public.usage_policies%rowtype;
  current_window public.usage_windows%rowtype;
  percentage numeric := 0;
  customer_status text := 'available';
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  select * into entitlement
  from public.entitlements
  where workspace_id = p_workspace_id and status = 'active'
  order by starts_at desc
  limit 1;
  if not found then return; end if;

  select * into policy
  from public.usage_policies
  where usage_policies.plan = entitlement.plan and active
  limit 1;
  if not found then return; end if;

  select * into current_window
  from public.usage_windows
  where workspace_id = p_workspace_id
    and ends_at > now()
    and status in ('open', 'warning', 'exhausted')
  order by started_at desc
  limit 1;

  if found then
    percentage := least(100, greatest(0, round(
      ((current_window.used_microusd + current_window.reserved_microusd)::numeric
        / current_window.budget_microusd) * 100,
      1
    )));
    customer_status := case
      when current_window.status = 'exhausted' or percentage >= 100 then 'limit_reached'
      when current_window.status = 'warning' or percentage >= current_window.warning_percentage then 'almost_used'
      else 'available'
    end;
  end if;

  return query select
    entitlement.plan,
    entitlement.ends_at,
    case when current_window.id is null then null else current_window.started_at end,
    case when current_window.id is null then null else current_window.ends_at end,
    percentage,
    policy.usage_warning_percentage,
    customer_status,
    policy.usage_window_mode = 'enforced';
end;
$$;

revoke all on function public.get_workspace_usage_summary(uuid) from public, anon;
grant execute on function public.get_workspace_usage_summary(uuid) to authenticated;

comment on function public.get_workspace_usage_summary(uuid) is
  'Customer-safe five-hour usage state. Exposes percentage and localized-time inputs without raw costs, tokens, models or routing details.';

commit;
