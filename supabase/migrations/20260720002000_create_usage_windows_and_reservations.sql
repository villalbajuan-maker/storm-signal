begin;

create table public.usage_windows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entitlement_id uuid not null references public.entitlements(id) on delete cascade,
  usage_policy_id uuid not null references public.usage_policies(id) on delete restrict,
  opened_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'open'
    check (status in ('open', 'warning', 'exhausted', 'closed', 'voided')),
  started_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > started_at),
  budget_microusd bigint not null check (budget_microusd > 0),
  used_microusd bigint not null default 0 check (used_microusd >= 0),
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  warning_percentage numeric(5,2) not null check (warning_percentage > 0 and warning_percentage < 100),
  pricing_version text not null check (length(trim(pricing_version)) between 1 and 80),
  warning_reached_at timestamptz,
  exhausted_at timestamptz,
  closed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create unique index usage_windows_one_current_workspace_idx
  on public.usage_windows (workspace_id)
  where status in ('open', 'warning', 'exhausted');
create index usage_windows_workspace_started_idx
  on public.usage_windows (workspace_id, started_at desc);
create index usage_windows_entitlement_started_idx
  on public.usage_windows (entitlement_id, started_at desc);
create index usage_windows_due_idx
  on public.usage_windows (ends_at)
  where status in ('open', 'warning', 'exhausted');

alter table public.execution_runs
  add constraint execution_runs_id_workspace_unique unique (id, workspace_id),
  add column if not exists usage_window_id uuid,
  add column if not exists reserved_cost_microusd bigint not null default 0
    check (reserved_cost_microusd >= 0),
  add column if not exists estimated_cost_microusd bigint not null default 0
    check (estimated_cost_microusd >= 0),
  add constraint execution_runs_usage_window_fk
    foreign key (usage_window_id)
    references public.usage_windows(id) on delete set null;

create index execution_runs_usage_window_idx
  on public.execution_runs (usage_window_id, created_at)
  where usage_window_id is not null;

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  usage_window_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  execution_run_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  capability text not null check (length(trim(capability)) between 1 and 80),
  selected_alias text not null check (length(trim(selected_alias)) between 1 and 80),
  selected_model text not null check (length(trim(selected_model)) between 1 and 160),
  status text not null default 'reserved'
    check (status in ('reserved', 'reconciled', 'released', 'expired')),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  actual_microusd bigint not null default 0 check (actual_microusd >= 0),
  expires_at timestamptz not null,
  reconciled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_run_id, attempt_number),
  foreign key (usage_window_id, workspace_id)
    references public.usage_windows(id, workspace_id) on delete cascade,
  foreign key (execution_run_id, workspace_id)
    references public.execution_runs(id, workspace_id) on delete cascade
);

create index usage_reservations_window_status_idx
  on public.usage_reservations (usage_window_id, status, created_at);
create index usage_reservations_expiration_idx
  on public.usage_reservations (expires_at)
  where status = 'reserved';
create index usage_reservations_workspace_created_idx
  on public.usage_reservations (workspace_id, created_at desc);

alter table public.model_operation_logs
  add column if not exists usage_window_id uuid,
  add column if not exists usage_reservation_id uuid,
  add column if not exists estimated_cost_microusd bigint not null default 0
    check (estimated_cost_microusd >= 0),
  add constraint model_operation_logs_usage_window_fk
    foreign key (usage_window_id)
    references public.usage_windows(id) on delete set null,
  add constraint model_operation_logs_usage_reservation_fk
    foreign key (usage_reservation_id)
    references public.usage_reservations(id) on delete set null;

create index model_operation_logs_usage_window_idx
  on public.model_operation_logs (usage_window_id, created_at)
  where usage_window_id is not null;

create table public.usage_window_events (
  id uuid primary key default gen_random_uuid(),
  usage_window_id uuid not null,
  workspace_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  execution_run_id uuid,
  event_type text not null
    check (event_type in (
      'opened', 'warning_reached', 'exhausted', 'closed', 'voided',
      'reservation_created', 'reservation_reconciled', 'reservation_released', 'reservation_expired'
    )),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (usage_window_id, workspace_id)
    references public.usage_windows(id, workspace_id) on delete cascade,
  foreign key (execution_run_id)
    references public.execution_runs(id) on delete set null
);

create index usage_window_events_window_time_idx
  on public.usage_window_events (usage_window_id, occurred_at, id);
create index usage_window_events_workspace_time_idx
  on public.usage_window_events (workspace_id, occurred_at desc);
create index usage_window_events_type_time_idx
  on public.usage_window_events (event_type, occurred_at desc);

create trigger usage_windows_set_updated_at
  before update on public.usage_windows
  for each row execute function public.set_updated_at();
create trigger usage_reservations_set_updated_at
  before update on public.usage_reservations
  for each row execute function public.set_updated_at();

alter table public.usage_windows enable row level security;
alter table public.usage_reservations enable row level security;
alter table public.usage_window_events enable row level security;

revoke all on public.usage_windows from anon, authenticated;
revoke all on public.usage_reservations from anon, authenticated;
revoke all on public.usage_window_events from anon, authenticated;

comment on table public.usage_windows is
  'Authoritative fixed five-hour usage windows. Economic fields are server-only and snapshotted from the active policy.';
comment on table public.usage_reservations is
  'Per-model-attempt staged reservations. Fallback attempts reserve incrementally rather than cumulatively in advance.';
comment on table public.usage_window_events is
  'Append-only operational audit of window lifecycle and reservation transitions.';
comment on column public.execution_runs.usage_window_id is
  'Window that authorized this model-backed execution; null for legacy executions.';
comment on column public.execution_runs.reserved_cost_microusd is
  'Current total staged reservation for the execution, in millionths of one US dollar.';
comment on column public.execution_runs.estimated_cost_microusd is
  'Reconciled provider-cost estimate for the execution, in millionths of one US dollar.';

commit;
