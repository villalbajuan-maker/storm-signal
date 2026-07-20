begin;

create or replace function public.reserve_usage_attempt_for_user(
  p_user_id uuid,
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_execution_run_id uuid,
  p_attempt_number integer,
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
  current_window public.usage_windows%rowtype;
  current_run public.execution_runs%rowtype;
  existing_reservation public.usage_reservations%rowtype;
  expired_reservation record;
  new_run_id uuid;
  new_window_id uuid;
  new_reservation_id uuid;
  period_used bigint := 0;
  window_used bigint := 0;
  window_reserved bigint := 0;
  block_reason text := null;
  is_shadow boolean := false;
  percentage numeric := 0;
begin
  if p_user_id is null then raise exception 'User required' using errcode = '22023'; end if;
  if p_attempt_number is null or p_attempt_number < 1 then raise exception 'Invalid attempt number' using errcode = '22023'; end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then raise exception 'Invalid idempotency key' using errcode = '22023'; end if;
  if length(trim(coalesce(p_capability, ''))) < 1 then raise exception 'Capability required' using errcode = '22023'; end if;
  if length(trim(coalesce(p_selected_alias, ''))) < 1 then raise exception 'Model alias required' using errcode = '22023'; end if;
  if length(trim(coalesce(p_selected_model, ''))) < 1 then raise exception 'Model required' using errcode = '22023'; end if;
  if p_reserved_microusd is null or p_reserved_microusd <= 0 then raise exception 'Positive reservation required' using errcode = '22023'; end if;

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id and status = 'active'
  ) then raise exception 'Workspace access denied' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

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
  if policy.usage_window_mode = 'disabled' then
    return query select null::uuid, null::uuid, null::uuid, 'window_policy_disabled'::text, 0, false, 0::numeric;
    return;
  end if;
  if policy.usage_window_budget_microusd is null or policy.max_period_cost_microusd is null or policy.max_operation_cost_microusd is null then
    return query select null::uuid, null::uuid, null::uuid, 'window_policy_incomplete'::text, 0, true, 0::numeric;
    return;
  end if;
  is_shadow := policy.usage_window_mode = 'shadow';

  for expired_reservation in
    select r.id, r.usage_window_id, r.execution_run_id, r.reserved_microusd
    from public.usage_reservations r
    join public.usage_windows w on w.id = r.usage_window_id
    where r.workspace_id = p_workspace_id and r.status = 'reserved'
      and (r.expires_at <= now() or w.ends_at <= now())
    for update of r
  loop
    update public.usage_reservations
    set status = 'expired', released_at = now()
    where id = expired_reservation.id;
    update public.usage_windows
    set reserved_microusd = greatest(0, reserved_microusd - expired_reservation.reserved_microusd)
    where id = expired_reservation.usage_window_id;
    update public.execution_runs
    set reserved_cost_microusd = greatest(0, reserved_cost_microusd - expired_reservation.reserved_microusd)
    where id = expired_reservation.execution_run_id;
    insert into public.usage_window_events (
      usage_window_id, workspace_id, execution_run_id, event_type, details
    ) values (
      expired_reservation.usage_window_id, p_workspace_id, expired_reservation.execution_run_id,
      'reservation_expired', jsonb_build_object('reservation_id', expired_reservation.id)
    );
  end loop;

  select * into current_window from public.usage_windows
  where workspace_id = p_workspace_id and status in ('open', 'warning', 'exhausted')
  order by started_at desc limit 1 for update;
  if found and current_window.ends_at <= now() then
    update public.usage_windows
    set status = 'closed', closed_at = now(), reserved_microusd = 0
    where id = current_window.id;
    insert into public.usage_window_events (
      usage_window_id, workspace_id, user_id, event_type, details
    ) values (
      current_window.id, p_workspace_id, p_user_id, 'closed',
      jsonb_build_object('scheduled_end', current_window.ends_at)
    );
    current_window.id := null;
  end if;

  if p_execution_run_id is not null then
    select * into current_run from public.execution_runs
    where id = p_execution_run_id and workspace_id = p_workspace_id and user_id = p_user_id
      and status in ('reserved', 'running')
    for update;
    if not found then
      return query select null::uuid, null::uuid, null::uuid, 'run_unavailable'::text, 0, true, 0::numeric;
      return;
    end if;
    if current_run.usage_window_id is null then
      return query select current_run.id, null::uuid, null::uuid, 'run_not_windowed'::text, 0, true, 0::numeric;
      return;
    end if;
    select * into current_window from public.usage_windows
    where id = current_run.usage_window_id and workspace_id = p_workspace_id
      and status in ('open', 'warning', 'exhausted') and ends_at > now()
    for update;
    if not found then
      return query select current_run.id, current_run.usage_window_id, null::uuid, 'window_closed'::text, 0, true, 0::numeric;
      return;
    end if;
    select * into existing_reservation from public.usage_reservations
    where execution_run_id = current_run.id and attempt_number = p_attempt_number;
    if found then
      percentage := round(((current_window.used_microusd + current_window.reserved_microusd)::numeric / current_window.budget_microusd) * 100, 2);
      return query select current_run.id, current_window.id, existing_reservation.id, 'duplicate'::text, 0, false, percentage;
      return;
    end if;
    new_run_id := current_run.id;
  else
    select * into current_run from public.execution_runs
    where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
    if found then
      select * into existing_reservation from public.usage_reservations
      where execution_run_id = current_run.id and attempt_number = p_attempt_number;
      return query select current_run.id, current_run.usage_window_id, existing_reservation.id,
        'duplicate'::text, 0, false, 0::numeric;
      return;
    end if;
  end if;

  if current_window.id is null then
    window_used := 0;
    window_reserved := 0;
  else
    window_used := current_window.used_microusd;
    window_reserved := current_window.reserved_microusd;
  end if;

  select coalesce(sum(used_microusd + reserved_microusd), 0) into period_used
  from public.usage_windows
  where entitlement_id = entitlement.id and status <> 'voided';

  if p_reserved_microusd > policy.max_operation_cost_microusd then
    block_reason := 'operation_limit';
  elsif window_used + window_reserved + p_reserved_microusd > policy.usage_window_budget_microusd then
    block_reason := 'window_limit';
  elsif period_used + p_reserved_microusd > policy.max_period_cost_microusd then
    block_reason := 'period_budget';
  end if;

  if block_reason is not null and not is_shadow then
    percentage := round(((window_used + window_reserved)::numeric / policy.usage_window_budget_microusd) * 100, 2);
    return query select coalesce(new_run_id, p_execution_run_id), current_window.id, null::uuid,
      block_reason, case when current_window.id is null then 0 else greatest(1, extract(epoch from (current_window.ends_at - now()))::integer) end,
      true, percentage;
    return;
  end if;

  if current_window.id is null then
    insert into public.usage_windows (
      workspace_id, entitlement_id, usage_policy_id, opened_by, status,
      started_at, ends_at, budget_microusd, warning_percentage, pricing_version
    ) values (
      p_workspace_id, entitlement.id, policy.id, p_user_id, 'open', now(),
      least(now() + make_interval(mins => policy.usage_window_minutes), entitlement.ends_at),
      policy.usage_window_budget_microusd, policy.usage_warning_percentage, policy.usage_pricing_version
    ) returning id into new_window_id;
    select * into current_window from public.usage_windows where id = new_window_id for update;
    insert into public.usage_window_events (
      usage_window_id, workspace_id, user_id, event_type, details
    ) values (
      current_window.id, p_workspace_id, p_user_id, 'opened',
      jsonb_build_object('mode', policy.usage_window_mode, 'ends_at', current_window.ends_at)
    );
  else
    new_window_id := current_window.id;
  end if;

  if p_execution_run_id is null then
    insert into public.execution_runs (
      workspace_id, user_id, conversation_id, usage_window_id, idempotency_key,
      status, model, reserved_cost_microusd, estimated_cost_cents, started_at
    ) values (
      p_workspace_id, p_user_id, p_conversation_id, current_window.id, trim(p_idempotency_key),
      'running', trim(p_selected_model), p_reserved_microusd,
      ceil(p_reserved_microusd::numeric / 10000)::integer, now()
    ) returning id into new_run_id;
  else
    update public.execution_runs
    set reserved_cost_microusd = reserved_cost_microusd + p_reserved_microusd
    where id = new_run_id;
  end if;

  insert into public.usage_reservations (
    usage_window_id, workspace_id, user_id, execution_run_id, attempt_number,
    capability, selected_alias, selected_model, status, reserved_microusd, expires_at
  ) values (
    current_window.id, p_workspace_id, p_user_id, new_run_id, p_attempt_number,
    trim(p_capability), trim(p_selected_alias), trim(p_selected_model), 'reserved',
    p_reserved_microusd, now() + make_interval(secs => policy.reservation_expiration_seconds)
  ) returning id into new_reservation_id;

  update public.usage_windows
  set reserved_microusd = reserved_microusd + p_reserved_microusd
  where id = current_window.id
  returning * into current_window;

  insert into public.usage_window_events (
    usage_window_id, workspace_id, user_id, execution_run_id, event_type, details
  ) values (
    current_window.id, p_workspace_id, p_user_id, new_run_id, 'reservation_created',
    jsonb_build_object(
      'reservation_id', new_reservation_id,
      'attempt_number', p_attempt_number,
      'reserved_microusd', p_reserved_microusd,
      'would_block', block_reason is not null,
      'block_reason', block_reason
    )
  );

  percentage := round(((current_window.used_microusd + current_window.reserved_microusd)::numeric / current_window.budget_microusd) * 100, 2);
  return query select new_run_id, current_window.id, new_reservation_id,
    case when block_reason is not null then 'shadow_reserved' else 'reserved' end,
    0, block_reason is not null, percentage;
end;
$$;

create or replace function public.reconcile_usage_attempt_for_user(
  p_user_id uuid,
  p_reservation_id uuid,
  p_outcome text,
  p_actual_microusd bigint
)
returns table (
  run_id uuid,
  window_id uuid,
  result_code text,
  window_status text,
  used_microusd bigint,
  reserved_microusd bigint,
  usage_percentage numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.usage_reservations%rowtype;
  current_window public.usage_windows%rowtype;
  terminal_reservation_status text;
  next_window_status text;
  percentage numeric;
  reservation_count integer;
  transition_event text := null;
begin
  if p_outcome not in ('succeeded', 'quality_rejected', 'failed_billable', 'failed_nonbillable', 'canceled') then
    raise exception 'Invalid reservation outcome' using errcode = '22023';
  end if;
  if p_actual_microusd is null or p_actual_microusd < 0 then
    raise exception 'Invalid actual cost' using errcode = '22023';
  end if;

  select * into reservation from public.usage_reservations
  where id = p_reservation_id and user_id = p_user_id;
  if not found then raise exception 'Reservation unavailable' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(reservation.workspace_id::text, 0));
  select * into reservation from public.usage_reservations
  where id = p_reservation_id and user_id = p_user_id for update;
  select * into current_window from public.usage_windows
  where id = reservation.usage_window_id for update;

  if reservation.status <> 'reserved' then
    percentage := round(((current_window.used_microusd + current_window.reserved_microusd)::numeric / current_window.budget_microusd) * 100, 2);
    return query select reservation.execution_run_id, current_window.id, 'already_reconciled'::text,
      current_window.status, current_window.used_microusd, current_window.reserved_microusd, percentage;
    return;
  end if;

  terminal_reservation_status := case
    when p_actual_microusd = 0 and p_outcome in ('failed_nonbillable', 'canceled') then 'released'
    else 'reconciled'
  end;

  update public.usage_reservations
  set status = terminal_reservation_status,
      actual_microusd = p_actual_microusd,
      reconciled_at = case when terminal_reservation_status = 'reconciled' then now() else null end,
      released_at = case when terminal_reservation_status = 'released' then now() else null end
  where id = reservation.id;

  update public.execution_runs
  set reserved_cost_microusd = greatest(0, reserved_cost_microusd - reservation.reserved_microusd),
      estimated_cost_microusd = estimated_cost_microusd + p_actual_microusd
  where id = reservation.execution_run_id;

  update public.usage_windows as target_window
  set reserved_microusd = greatest(0, target_window.reserved_microusd - reservation.reserved_microusd),
      used_microusd = target_window.used_microusd + p_actual_microusd
  where target_window.id = current_window.id
  returning * into current_window;

  select count(*) into reservation_count from public.usage_reservations
  where usage_window_id = current_window.id;

  if p_outcome = 'failed_nonbillable' and p_actual_microusd = 0
    and current_window.used_microusd = 0 and current_window.reserved_microusd = 0
    and reservation_count = 1 then
    update public.usage_windows
    set status = 'voided', voided_at = now()
    where id = current_window.id returning * into current_window;
    insert into public.usage_window_events (
      usage_window_id, workspace_id, user_id, execution_run_id, event_type, details
    ) values (
      current_window.id, current_window.workspace_id, p_user_id, reservation.execution_run_id,
      'voided', jsonb_build_object('reason', 'first_operation_failed_nonbillable')
    );
  else
    percentage := round((current_window.used_microusd::numeric / current_window.budget_microusd) * 100, 2);
    next_window_status := case
      when current_window.used_microusd >= current_window.budget_microusd then 'exhausted'
      when percentage >= current_window.warning_percentage then 'warning'
      else 'open'
    end;
    if next_window_status <> current_window.status then
      transition_event := case next_window_status when 'warning' then 'warning_reached' when 'exhausted' then 'exhausted' else null end;
      update public.usage_windows
      set status = next_window_status,
          warning_reached_at = case when next_window_status in ('warning', 'exhausted') then coalesce(warning_reached_at, now()) else warning_reached_at end,
          exhausted_at = case when next_window_status = 'exhausted' then coalesce(exhausted_at, now()) else exhausted_at end
      where id = current_window.id returning * into current_window;
      if transition_event is not null then
        insert into public.usage_window_events (
          usage_window_id, workspace_id, user_id, execution_run_id, event_type, details
        ) values (
          current_window.id, current_window.workspace_id, p_user_id, reservation.execution_run_id,
          transition_event, jsonb_build_object('used_microusd', current_window.used_microusd, 'budget_microusd', current_window.budget_microusd)
        );
      end if;
    end if;
  end if;

  insert into public.usage_window_events (
    usage_window_id, workspace_id, user_id, execution_run_id, event_type, details
  ) values (
    current_window.id, current_window.workspace_id, p_user_id, reservation.execution_run_id,
    case when terminal_reservation_status = 'released' then 'reservation_released' else 'reservation_reconciled' end,
    jsonb_build_object(
      'reservation_id', reservation.id,
      'attempt_number', reservation.attempt_number,
      'outcome', p_outcome,
      'actual_microusd', p_actual_microusd
    )
  );

  percentage := round((current_window.used_microusd::numeric / current_window.budget_microusd) * 100, 2);
  return query select reservation.execution_run_id, current_window.id, 'reconciled'::text,
    current_window.status, current_window.used_microusd, current_window.reserved_microusd, percentage;
end;
$$;

revoke all on function public.reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.reconcile_usage_attempt_for_user(
  uuid, uuid, text, bigint
) from public, anon, authenticated;

grant execute on function public.reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, bigint
) to service_role;
grant execute on function public.reconcile_usage_attempt_for_user(
  uuid, uuid, text, bigint
) to service_role;

comment on function public.reserve_usage_attempt_for_user(
  uuid, uuid, uuid, text, uuid, integer, text, text, text, bigint
) is 'Atomically opens or reuses a fixed window and reserves one selected model attempt. Shadow mode records would-block outcomes without denying execution.';
comment on function public.reconcile_usage_attempt_for_user(
  uuid, uuid, text, bigint
) is 'Reconciles one staged model-attempt reservation, transitions window state and voids a new empty window after a non-billable first failure.';

commit;
