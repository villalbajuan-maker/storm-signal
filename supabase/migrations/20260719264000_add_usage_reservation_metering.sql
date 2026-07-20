begin;

create or replace function public.reserve_execution(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_model text,
  p_reserved_cost_cents integer default 25
)
returns table (run_id uuid, result_code text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  entitlement public.entitlements%rowtype;
  policy public.usage_policies%rowtype;
  existing_run public.execution_runs%rowtype;
  active_runs integer;
  minute_requests integer;
  daily_requests integer;
  period_cost integer;
  new_run_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select * into existing_run
  from public.execution_runs
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    return query select existing_run.id, 'duplicate'::text, 0;
    return;
  end if;

  update public.execution_runs
  set status = 'failed', error_code = 'reservation_timeout', completed_at = now()
  where workspace_id = p_workspace_id
    and status in ('reserved', 'running')
    and created_at < now() - interval '10 minutes';

  select * into entitlement
  from public.entitlements
  where workspace_id = p_workspace_id
    and status = 'active'
    and starts_at <= now() and now() < ends_at
  order by starts_at desc limit 1;
  if not found then
    return query select null::uuid, 'entitlement_inactive'::text, 0;
    return;
  end if;

  select * into policy
  from public.usage_policies
  where plan = entitlement.plan and active
  limit 1;
  if not found then
    return query select null::uuid, 'policy_unavailable'::text, 0;
    return;
  end if;

  select count(*) into minute_requests
  from public.execution_runs
  where workspace_id = p_workspace_id and created_at >= now() - interval '1 minute';
  if minute_requests >= policy.max_requests_per_minute then
    return query select null::uuid, 'minute_limit'::text, 60;
    return;
  end if;

  select count(*) into daily_requests
  from public.execution_runs
  where workspace_id = p_workspace_id
    and created_at >= date_trunc('day', now())
    and status not in ('failed', 'canceled');
  if daily_requests >= policy.max_daily_investigations then
    return query select null::uuid, 'daily_limit'::text,
      greatest(1, extract(epoch from (date_trunc('day', now()) + interval '1 day' - now()))::integer);
    return;
  end if;

  select count(*) into active_runs
  from public.execution_runs
  where workspace_id = p_workspace_id and status in ('reserved', 'running');
  if active_runs >= policy.max_concurrent_runs then
    return query select null::uuid, 'concurrent_limit'::text, 15;
    return;
  end if;

  select coalesce(sum(estimated_cost_cents), 0) into period_cost
  from public.execution_runs
  where workspace_id = p_workspace_id
    and created_at >= entitlement.starts_at and created_at < entitlement.ends_at
    and status in ('reserved', 'running', 'succeeded');
  if period_cost + greatest(0, p_reserved_cost_cents) > policy.max_period_cost_cents then
    return query select null::uuid, 'period_budget'::text, 0;
    return;
  end if;

  insert into public.execution_runs (
    workspace_id, user_id, conversation_id, idempotency_key, status,
    model, estimated_cost_cents, started_at
  ) values (
    p_workspace_id, caller_id, p_conversation_id, trim(p_idempotency_key), 'running',
    p_model, greatest(0, p_reserved_cost_cents), now()
  ) returning id into new_run_id;

  return query select new_run_id, 'reserved'::text, 0;
end;
$$;

create or replace function public.finalize_execution(
  p_run_id uuid,
  p_status text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_mcp_calls integer default 0,
  p_estimated_cost_cents integer default 0,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_status not in ('succeeded', 'failed', 'canceled') then
    raise exception 'Invalid terminal status' using errcode = '22023';
  end if;

  update public.execution_runs
  set status = p_status,
      input_tokens = greatest(0, p_input_tokens),
      output_tokens = greatest(0, p_output_tokens),
      mcp_calls = greatest(0, p_mcp_calls),
      estimated_cost_cents = case when p_status = 'succeeded' then greatest(0, p_estimated_cost_cents) else 0 end,
      error_code = left(p_error_code, 100),
      completed_at = now()
  where id = p_run_id
    and user_id = caller_id
    and status in ('reserved', 'running')
    and public.is_workspace_member(workspace_id);

  return found;
end;
$$;

revoke all on function public.reserve_execution(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.finalize_execution(uuid, text, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.reserve_execution(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.finalize_execution(uuid, text, integer, integer, integer, integer, text) to authenticated;

commit;
