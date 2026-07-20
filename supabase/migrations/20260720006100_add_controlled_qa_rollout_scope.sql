begin;

alter table public.workspaces
  add column if not exists workspace_type text not null default 'customer'
    check (workspace_type in ('customer', 'controlled_qa'));

create table public.usage_rollout_settings (
  plan text primary key check (plan in ('trial', 'quarterly', 'annual')),
  minimum_windows integer not null check (minimum_windows > 0),
  minimum_attempts integer not null check (minimum_attempts > 0),
  minimum_completed_cycles integer not null check (minimum_completed_cycles > 0),
  required_telemetry_percentage numeric(5,2) not null
    check (required_telemetry_percentage > 0 and required_telemetry_percentage <= 100),
  updated_at timestamptz not null default now()
);

insert into public.usage_rollout_settings (
  plan, minimum_windows, minimum_attempts,
  minimum_completed_cycles, required_telemetry_percentage
) values ('trial', 5, 12, 1, 100)
on conflict (plan) do update set
  minimum_windows = excluded.minimum_windows,
  minimum_attempts = excluded.minimum_attempts,
  minimum_completed_cycles = excluded.minimum_completed_cycles,
  required_telemetry_percentage = excluded.required_telemetry_percentage,
  updated_at = now();

alter table public.usage_rollout_settings enable row level security;
revoke all on public.usage_rollout_settings from anon, authenticated;
grant select on public.usage_rollout_settings to service_role;
grant select on public.usage_window_operational_audit to service_role;
grant select on public.usage_operational_alerts to service_role;

create or replace function public.evaluate_trial_usage_enforcement_readiness()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_result jsonb;
  settings public.usage_rollout_settings%rowtype;
  window_count integer := 0;
  qa_window_count integer := 0;
  customer_window_count integer := 0;
  attempt_count integer := 0;
  completed_cycle_count integer := 0;
  telemetry_attempt_count integer := 0;
  shadow_would_block_count integer := 0;
  telemetry_percentage numeric := 0;
  current_mode text;
  is_ready boolean := false;
begin
  audit_result := public.run_usage_metering_audit();

  select * into settings
  from public.usage_rollout_settings
  where plan = 'trial';
  if not found then raise exception 'Trial rollout settings are unavailable'; end if;

  select usage_window_mode into current_mode
  from public.usage_policies
  where plan = 'trial' and active
  order by created_at desc limit 1;

  select
    count(*),
    count(*) filter (where workspace.workspace_type = 'controlled_qa'),
    count(*) filter (where workspace.workspace_type = 'customer'),
    count(*) filter (where audit.run_count >= 3)
  into window_count, qa_window_count, customer_window_count, completed_cycle_count
  from public.usage_window_operational_audit audit
  join public.workspaces workspace on workspace.id = audit.workspace_id
  join public.entitlements entitlement on entitlement.id = (
    select usage_window.entitlement_id from public.usage_windows usage_window
    where usage_window.id = audit.usage_window_id
  )
  where audit.status <> 'voided' and entitlement.plan = 'trial';

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

  telemetry_percentage := case when attempt_count = 0 then 0
    else round((telemetry_attempt_count::numeric / attempt_count) * 100, 2) end;

  select count(*) into shadow_would_block_count
  from public.usage_window_events event
  join public.usage_windows usage_window on usage_window.id = event.usage_window_id
  join public.entitlements entitlement on entitlement.id = usage_window.entitlement_id
  where entitlement.plan = 'trial'
    and event.event_type = 'reservation_created'
    and coalesce((event.details ->> 'would_block')::boolean, false);

  is_ready :=
    coalesce((audit_result ->> 'critical_alerts')::integer, 0) = 0
    and window_count >= settings.minimum_windows
    and attempt_count >= settings.minimum_attempts
    and completed_cycle_count >= settings.minimum_completed_cycles
    and telemetry_percentage >= settings.required_telemetry_percentage;

  return jsonb_build_object(
    'ready', is_ready,
    'current_mode', current_mode,
    'window_count', window_count,
    'controlled_qa_window_count', qa_window_count,
    'customer_window_count', customer_window_count,
    'minimum_windows', settings.minimum_windows,
    'attempt_count', attempt_count,
    'minimum_attempts', settings.minimum_attempts,
    'completed_cycle_count', completed_cycle_count,
    'minimum_completed_cycles', settings.minimum_completed_cycles,
    'telemetry_coverage_percentage', telemetry_percentage,
    'required_telemetry_percentage', settings.required_telemetry_percentage,
    'shadow_would_block_count', shadow_would_block_count,
    'critical_alerts', coalesce((audit_result ->> 'critical_alerts')::integer, 0),
    'requires_human_review', true,
    'evaluated_at', now()
  );
end;
$$;

revoke all on function public.evaluate_trial_usage_enforcement_readiness()
  from public, anon, authenticated;
grant execute on function public.evaluate_trial_usage_enforcement_readiness()
  to service_role;

comment on column public.workspaces.workspace_type is
  'Separates customer workspaces from retained controlled-QA evidence used for rollout calibration.';
comment on table public.usage_rollout_settings is
  'Server-only configurable evidence thresholds for guarded usage-policy activation.';

commit;
