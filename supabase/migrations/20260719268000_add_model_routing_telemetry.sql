begin;

create table public.model_operation_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete cascade,
  execution_run_id uuid references public.execution_runs(id) on delete set null,
  operation text not null,
  capability text not null,
  attempt_number integer not null check (attempt_number > 0),
  selected_alias text not null,
  selected_model text not null,
  selection_reason text not null,
  status text not null check (status in ('succeeded', 'quality_rejected', 'failed')),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  estimated_cost_cents integer not null default 0 check (estimated_cost_cents >= 0),
  error_code text,
  created_at timestamptz not null default now()
);

create index model_operation_logs_workspace_created_idx on public.model_operation_logs (workspace_id, created_at desc);
create index model_operation_logs_run_idx on public.model_operation_logs (execution_run_id, attempt_number);
alter table public.model_operation_logs enable row level security;
create policy model_operation_logs_owner_select on public.model_operation_logs for select to authenticated
  using (public.is_workspace_owner(workspace_id));
revoke all on public.model_operation_logs from anon, authenticated;
grant select on public.model_operation_logs to authenticated;

alter table public.execution_runs
  add column if not exists routing_capability text,
  add column if not exists routing_reason text,
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists latency_ms integer not null default 0 check (latency_ms >= 0),
  add column if not exists cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  add column if not exists cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0);

commit;
