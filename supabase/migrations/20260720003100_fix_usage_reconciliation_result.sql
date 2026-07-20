begin;

drop function if exists public.reconcile_usage_attempt_for_user(uuid, uuid, text, bigint);

create function public.reconcile_usage_attempt_for_user(
  p_user_id uuid,
  p_reservation_id uuid,
  p_outcome text,
  p_actual_microusd bigint
)
returns jsonb
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
    return jsonb_build_object(
      'run_id', reservation.execution_run_id,
      'window_id', current_window.id,
      'result_code', 'already_reconciled',
      'window_status', current_window.status,
      'used_microusd', current_window.used_microusd,
      'reserved_microusd', current_window.reserved_microusd,
      'usage_percentage', percentage
    );
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

  update public.execution_runs as target_run
  set reserved_cost_microusd = greatest(0, target_run.reserved_cost_microusd - reservation.reserved_microusd),
      estimated_cost_microusd = target_run.estimated_cost_microusd + p_actual_microusd
  where target_run.id = reservation.execution_run_id;

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
  return jsonb_build_object(
    'run_id', reservation.execution_run_id,
    'window_id', current_window.id,
    'result_code', 'reconciled',
    'window_status', current_window.status,
    'used_microusd', current_window.used_microusd,
    'reserved_microusd', current_window.reserved_microusd,
    'usage_percentage', percentage
  );
end;
$$;

revoke all on function public.reconcile_usage_attempt_for_user(uuid, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.reconcile_usage_attempt_for_user(uuid, uuid, text, bigint)
  to service_role;

comment on function public.reconcile_usage_attempt_for_user(uuid, uuid, text, bigint) is
  'Reconciles one staged attempt and returns a JSON state snapshot without exposing raw economics to browser roles.';

commit;
