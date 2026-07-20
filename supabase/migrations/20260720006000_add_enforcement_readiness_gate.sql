begin;

create or replace function public.evaluate_trial_usage_enforcement_readiness()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_result jsonb;
  window_count integer := 0;
  attempt_count integer := 0;
  completed_cycle_count integer := 0;
  telemetry_attempt_count integer := 0;
  shadow_would_block_count integer := 0;
  current_mode text;
  is_ready boolean := false;
begin
  audit_result := public.run_usage_metering_audit();

  select usage_window_mode into current_mode
  from public.usage_policies
  where plan = 'trial' and active
  order by created_at desc
  limit 1;

  select
    count(*),
    count(*) filter (where audit.run_count >= 3)
  into window_count, completed_cycle_count
  from public.usage_window_operational_audit audit
  where audit.status <> 'voided';

  select count(*) into attempt_count
  from public.usage_reservations reservation
  join public.usage_windows usage_window on usage_window.id = reservation.usage_window_id
  join public.entitlements entitlement on entitlement.id = usage_window.entitlement_id
  where entitlement.plan = 'trial';

  select count(*) into telemetry_attempt_count
  from public.usage_reservations reservation
  join public.usage_windows usage_window on usage_window.id = reservation.usage_window_id
  join public.entitlements entitlement on entitlement.id = usage_window.entitlement_id
  where entitlement.plan = 'trial'
    and exists (
      select 1 from public.model_operation_logs operation
      where operation.usage_reservation_id = reservation.id
    );

  select count(*) into shadow_would_block_count
  from public.usage_window_events event
  join public.usage_windows usage_window on usage_window.id = event.usage_window_id
  join public.entitlements entitlement on entitlement.id = usage_window.entitlement_id
  where entitlement.plan = 'trial'
    and event.event_type = 'reservation_created'
    and coalesce((event.details ->> 'would_block')::boolean, false);

  is_ready :=
    coalesce((audit_result ->> 'critical_alerts')::integer, 0) = 0
    and window_count >= 5
    and attempt_count >= 20
    and completed_cycle_count >= 1
    and telemetry_attempt_count = attempt_count;

  return jsonb_build_object(
    'ready', is_ready,
    'current_mode', current_mode,
    'window_count', window_count,
    'minimum_windows', 5,
    'attempt_count', attempt_count,
    'minimum_attempts', 20,
    'completed_cycle_count', completed_cycle_count,
    'minimum_completed_cycles', 1,
    'telemetry_coverage_percentage', case when attempt_count = 0 then 0 else round((telemetry_attempt_count::numeric / attempt_count) * 100, 2) end,
    'shadow_would_block_count', shadow_would_block_count,
    'critical_alerts', coalesce((audit_result ->> 'critical_alerts')::integer, 0),
    'requires_human_review', true,
    'evaluated_at', now()
  );
end;
$$;

create or replace function public.activate_trial_usage_enforcement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  readiness jsonb;
begin
  readiness := public.evaluate_trial_usage_enforcement_readiness();
  if not coalesce((readiness ->> 'ready')::boolean, false) then
    raise exception 'Trial usage enforcement readiness gate is not satisfied'
      using errcode = '55000', detail = readiness::text;
  end if;

  update public.usage_policies
  set usage_window_mode = 'enforced'
  where plan = 'trial' and active and usage_window_mode = 'shadow';

  return readiness || jsonb_build_object('activated', true, 'activated_at', now());
end;
$$;

revoke all on function public.evaluate_trial_usage_enforcement_readiness()
  from public, anon, authenticated;
revoke all on function public.activate_trial_usage_enforcement()
  from public, anon, authenticated;
grant execute on function public.evaluate_trial_usage_enforcement_readiness()
  to service_role;
grant execute on function public.activate_trial_usage_enforcement()
  to service_role;

comment on function public.evaluate_trial_usage_enforcement_readiness() is
  'Evaluates mechanical evidence required before human approval of trial usage enforcement.';
comment on function public.activate_trial_usage_enforcement() is
  'Server-only guarded transition from shadow to enforced; refuses activation until readiness evidence is complete.';

commit;
