begin;

create or replace function public.authorize_and_reserve_usage_attempt_for_user(
  p_user_id uuid,
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_execution_run_id uuid,
  p_attempt_number integer,
  p_operation text,
  p_capability text,
  p_selected_alias text,
  p_selected_model text,
  p_reserved_microusd bigint
)
returns table (
  run_id uuid,
  window_id uuid,
  reservation_id uuid,
  result_code text,
  retry_after_seconds integer,
  would_block boolean,
  usage_percentage numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement public.entitlements%rowtype;
  policy public.usage_policies%rowtype;
  minute_requests integer;
  daily_requests integer;
  active_runs integer;
  legacy_period_cost integer;
  reservation_result record;
begin
  if length(trim(coalesce(p_operation, ''))) < 1 then
    raise exception 'Operation required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  if p_execution_run_id is null then
    select * into entitlement from public.entitlements
    where workspace_id = p_workspace_id and status = 'active'
      and starts_at <= now() and now() < ends_at
    order by starts_at desc limit 1;
    if not found then
      return query select null::uuid, null::uuid, null::uuid, 'entitlement_inactive'::text, 0, true, 0::numeric;
      return;
    end if;

    select * into policy from public.usage_policies
    where plan = entitlement.plan and active
    order by created_at desc limit 1;
    if not found then
      return query select null::uuid, null::uuid, null::uuid, 'policy_unavailable'::text, 0, true, 0::numeric;
      return;
    end if;

    select count(*) into minute_requests from public.execution_runs
    where workspace_id = p_workspace_id and created_at >= now() - interval '1 minute';
    if minute_requests >= policy.max_requests_per_minute then
      return query select null::uuid, null::uuid, null::uuid, 'minute_limit'::text, 60, true, 0::numeric;
      return;
    end if;

    select count(*) into active_runs from public.execution_runs
    where workspace_id = p_workspace_id and status in ('reserved', 'running');
    if active_runs >= policy.max_concurrent_runs then
      return query select null::uuid, null::uuid, null::uuid, 'concurrent_limit'::text, 15, true, 0::numeric;
      return;
    end if;

    if policy.usage_window_mode = 'shadow' and p_operation = 'weather_conversation' then
      select count(*) into daily_requests from public.execution_runs
      where workspace_id = p_workspace_id
        and created_at >= date_trunc('day', now())
        and status not in ('failed', 'canceled');
      if daily_requests >= policy.max_daily_investigations then
        return query select null::uuid, null::uuid, null::uuid, 'daily_limit'::text,
          greatest(1, extract(epoch from (date_trunc('day', now()) + interval '1 day' - now()))::integer),
          true, 0::numeric;
        return;
      end if;

      select coalesce(sum(estimated_cost_cents), 0) into legacy_period_cost
      from public.execution_runs
      where workspace_id = p_workspace_id
        and created_at >= entitlement.starts_at and created_at < entitlement.ends_at
        and status in ('reserved', 'running', 'succeeded');
      if legacy_period_cost + ceil(p_reserved_microusd::numeric / 10000)::integer > policy.max_period_cost_cents then
        return query select null::uuid, null::uuid, null::uuid, 'legacy_period_budget'::text, 0, true, 0::numeric;
        return;
      end if;
    end if;
  end if;

  select * into reservation_result
  from public.reserve_usage_attempt_for_user(
    p_user_id, p_workspace_id, p_conversation_id, p_idempotency_key,
    p_execution_run_id, p_attempt_number, p_capability,
    p_selected_alias, p_selected_model, p_reserved_microusd
  );

  if reservation_result.run_id is not null then
    update public.execution_runs
    set routing_capability = trim(p_capability)
    where id = reservation_result.run_id;
  end if;

  return query select
    reservation_result.run_id,
    reservation_result.window_id,
    reservation_result.reservation_id,
    reservation_result.result_code,
    reservation_result.retry_after_seconds,
    reservation_result.would_block,
    reservation_result.usage_percentage;
end;
$$;

revoke all on function public.authorize_and_reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.authorize_and_reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, text, bigint
) to service_role;

comment on function public.authorize_and_reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, text, bigint
) is 'Atomic application entry point. Preserves legacy chat limits in shadow mode, always preserves rate/concurrency guards, then delegates one staged model attempt to the five-hour authority.';

commit;
