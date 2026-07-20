begin;

create or replace function public.void_empty_usage_window_for_run(
  p_user_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.execution_runs%rowtype;
  target_window public.usage_windows%rowtype;
begin
  select * into target_run
  from public.execution_runs
  where id = p_run_id and user_id = p_user_id;

  if not found or target_run.usage_window_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_run.workspace_id::text, 0));

  select * into target_window
  from public.usage_windows
  where id = target_run.usage_window_id
    and workspace_id = target_run.workspace_id
  for update;

  if not found
    or target_window.status not in ('open', 'warning', 'exhausted')
    or target_window.used_microusd <> 0
    or target_window.reserved_microusd <> 0
    or exists (
      select 1
      from public.usage_reservations reservation
      where reservation.execution_run_id = target_run.id
        and reservation.actual_microusd > 0
    )
  then
    return false;
  end if;

  update public.usage_windows
  set status = 'voided',
      voided_at = now()
  where id = target_window.id;

  insert into public.usage_window_events (
    usage_window_id,
    workspace_id,
    user_id,
    execution_run_id,
    event_type,
    details
  ) values (
    target_window.id,
    target_window.workspace_id,
    p_user_id,
    target_run.id,
    'voided',
    jsonb_build_object('reason', 'terminal_operation_failed_without_billable_usage')
  );

  return true;
end;
$$;

revoke all on function public.void_empty_usage_window_for_run(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.void_empty_usage_window_for_run(uuid, uuid)
  to service_role;

comment on function public.void_empty_usage_window_for_run(uuid, uuid) is
  'Voids a newly opened five-hour window after a terminal operation whose complete fallback chain produced no billable usage.';

commit;
