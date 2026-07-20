begin;

create table public.usage_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  alert_type text not null check (alert_type in (
    'stale_reservation', 'window_ledger_mismatch', 'run_ledger_mismatch',
    'expired_active_window', 'missing_attempt_telemetry'
  )),
  severity text not null check (severity in ('warning', 'critical')),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_window_id uuid references public.usage_windows(id) on delete cascade,
  execution_run_id uuid references public.execution_runs(id) on delete set null,
  usage_reservation_id uuid references public.usage_reservations(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index usage_operational_alerts_open_idx
  on public.usage_operational_alerts (severity, last_detected_at desc)
  where resolved_at is null;
create index usage_operational_alerts_workspace_idx
  on public.usage_operational_alerts (workspace_id, last_detected_at desc);

create trigger usage_operational_alerts_set_updated_at
  before update on public.usage_operational_alerts
  for each row execute function public.set_updated_at();

alter table public.usage_operational_alerts enable row level security;
revoke all on public.usage_operational_alerts from anon, authenticated;

create or replace view public.usage_window_operational_audit
with (security_invoker = true)
as
select
  usage_window.id as usage_window_id,
  usage_window.workspace_id,
  workspace.name as workspace_name,
  usage_window.opened_by,
  usage_window.status,
  usage_window.started_at,
  usage_window.ends_at,
  usage_window.budget_microusd,
  usage_window.used_microusd,
  usage_window.reserved_microusd,
  round(least(100, greatest(0,
    ((usage_window.used_microusd + usage_window.reserved_microusd)::numeric / usage_window.budget_microusd) * 100
  )), 2) as usage_percentage,
  reservation_aggregate.run_count,
  reservation_aggregate.attempt_count,
  reservation_aggregate.fallback_attempt_count,
  reservation_aggregate.active_reservation_count,
  reservation_aggregate.reconciled_microusd,
  event_aggregate.shadow_would_block_count,
  usage_window.warning_reached_at,
  usage_window.exhausted_at,
  usage_window.closed_at,
  usage_window.voided_at
from public.usage_windows usage_window
join public.workspaces workspace on workspace.id = usage_window.workspace_id
cross join lateral (
  select
    count(distinct reservation.execution_run_id) as run_count,
    count(reservation.id) as attempt_count,
    count(reservation.id) filter (where reservation.attempt_number > 1) as fallback_attempt_count,
    count(reservation.id) filter (where reservation.status = 'reserved') as active_reservation_count,
    coalesce(sum(reservation.actual_microusd), 0)::bigint as reconciled_microusd
  from public.usage_reservations reservation
  where reservation.usage_window_id = usage_window.id
) reservation_aggregate
cross join lateral (
  select count(event.id) filter (
    where event.event_type = 'reservation_created'
      and coalesce((event.details ->> 'would_block')::boolean, false)
  ) as shadow_would_block_count
  from public.usage_window_events event
  where event.usage_window_id = usage_window.id
) event_aggregate;

revoke all on public.usage_window_operational_audit from public, anon, authenticated;

create or replace function public.run_usage_metering_audit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  detected integer := 0;
  critical_count integer := 0;
  warning_count integer := 0;
begin
  update public.usage_operational_alerts
  set resolved_at = now()
  where resolved_at is null;

  insert into public.usage_operational_alerts (
    fingerprint, alert_type, severity, workspace_id, usage_window_id,
    execution_run_id, usage_reservation_id, details
  )
  select
    'stale_reservation:' || reservation.id,
    'stale_reservation', 'critical', reservation.workspace_id,
    reservation.usage_window_id, reservation.execution_run_id, reservation.id,
    jsonb_build_object('expires_at', reservation.expires_at, 'reserved_microusd', reservation.reserved_microusd)
  from public.usage_reservations reservation
  where reservation.status = 'reserved' and reservation.expires_at <= now()
  on conflict (fingerprint) do update set
    last_detected_at = now(), resolved_at = null, details = excluded.details;

  insert into public.usage_operational_alerts (
    fingerprint, alert_type, severity, workspace_id, usage_window_id, details
  )
  select
    'window_ledger_mismatch:' || usage_window.id,
    'window_ledger_mismatch', 'critical', usage_window.workspace_id, usage_window.id,
    jsonb_build_object(
      'stored_used_microusd', usage_window.used_microusd,
      'calculated_used_microusd', ledger.actual_microusd,
      'stored_reserved_microusd', usage_window.reserved_microusd,
      'calculated_reserved_microusd', ledger.reserved_microusd
    )
  from public.usage_windows usage_window
  cross join lateral (
    select
      coalesce(sum(reservation.actual_microusd), 0)::bigint actual_microusd,
      coalesce(sum(reservation.reserved_microusd) filter (where reservation.status = 'reserved'), 0)::bigint reserved_microusd
    from public.usage_reservations reservation
    where reservation.usage_window_id = usage_window.id
  ) ledger
  where usage_window.used_microusd <> ledger.actual_microusd
     or usage_window.reserved_microusd <> ledger.reserved_microusd
  on conflict (fingerprint) do update set
    last_detected_at = now(), resolved_at = null, details = excluded.details;

  insert into public.usage_operational_alerts (
    fingerprint, alert_type, severity, workspace_id, usage_window_id,
    execution_run_id, details
  )
  select
    'run_ledger_mismatch:' || run.id,
    'run_ledger_mismatch', 'critical', run.workspace_id, run.usage_window_id, run.id,
    jsonb_build_object(
      'stored_cost_microusd', run.estimated_cost_microusd,
      'calculated_cost_microusd', ledger.actual_microusd,
      'stored_reserved_microusd', run.reserved_cost_microusd,
      'calculated_reserved_microusd', ledger.reserved_microusd
    )
  from public.execution_runs run
  cross join lateral (
    select
      coalesce(sum(reservation.actual_microusd), 0)::bigint actual_microusd,
      coalesce(sum(reservation.reserved_microusd) filter (where reservation.status = 'reserved'), 0)::bigint reserved_microusd
    from public.usage_reservations reservation
    where reservation.execution_run_id = run.id
  ) ledger
  where run.usage_window_id is not null
    and (run.estimated_cost_microusd <> ledger.actual_microusd
      or run.reserved_cost_microusd <> ledger.reserved_microusd)
  on conflict (fingerprint) do update set
    last_detected_at = now(), resolved_at = null, details = excluded.details;

  insert into public.usage_operational_alerts (
    fingerprint, alert_type, severity, workspace_id, usage_window_id, details
  )
  select
    'expired_active_window:' || usage_window.id,
    'expired_active_window', 'warning', usage_window.workspace_id, usage_window.id,
    jsonb_build_object('ends_at', usage_window.ends_at, 'status', usage_window.status)
  from public.usage_windows usage_window
  where usage_window.status in ('open', 'warning', 'exhausted')
    and usage_window.ends_at < now() - interval '10 minutes'
  on conflict (fingerprint) do update set
    last_detected_at = now(), resolved_at = null, details = excluded.details;

  insert into public.usage_operational_alerts (
    fingerprint, alert_type, severity, workspace_id, usage_window_id,
    execution_run_id, usage_reservation_id, details
  )
  select
    'missing_attempt_telemetry:' || reservation.id,
    'missing_attempt_telemetry', 'warning', reservation.workspace_id,
    reservation.usage_window_id, reservation.execution_run_id, reservation.id,
    jsonb_build_object('attempt_number', reservation.attempt_number, 'selected_alias', reservation.selected_alias)
  from public.usage_reservations reservation
  where reservation.status in ('reconciled', 'released')
    and reservation.updated_at < now() - interval '10 minutes'
    and not exists (
      select 1 from public.model_operation_logs operation
      where operation.usage_reservation_id = reservation.id
    )
  on conflict (fingerprint) do update set
    last_detected_at = now(), resolved_at = null, details = excluded.details;

  select count(*),
    count(*) filter (where severity = 'critical'),
    count(*) filter (where severity = 'warning')
  into detected, critical_count, warning_count
  from public.usage_operational_alerts
  where resolved_at is null;

  return jsonb_build_object(
    'audited_at', now(),
    'open_alerts', detected,
    'critical_alerts', critical_count,
    'warning_alerts', warning_count
  );
end;
$$;

revoke all on function public.run_usage_metering_audit() from public, anon, authenticated;
grant execute on function public.run_usage_metering_audit() to service_role;

comment on table public.usage_operational_alerts is
  'Durable server-only findings from economic-ledger and telemetry-integrity audits.';
comment on view public.usage_window_operational_audit is
  'Server-only per-window operational reconstruction for calibration and incident review.';
comment on function public.run_usage_metering_audit() is
  'Re-evaluates usage-ledger and telemetry anomalies, resolves cleared findings and returns current alert counts.';

commit;
