begin;

create extension if not exists pgcrypto with schema extensions;

create table public.signup_intents (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text not null,
  primary_market text not null check (primary_market in ('Texas', 'Florida', 'Louisiana', 'Georgia', 'North Carolina')),
  crew_size text not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'expired')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  activated_workspace_id uuid,
  created_at timestamptz not null default now(),
  constraint signup_intents_email_normalized check (email = lower(btrim(email))),
  constraint signup_intents_consumed_state check (
    (status = 'consumed' and consumed_at is not null and activated_by is not null and activated_workspace_id is not null)
    or status <> 'consumed'
  )
);

create index signup_intents_email_created_idx on public.signup_intents (email, created_at desc);
create index signup_intents_pending_expiry_idx on public.signup_intents (expires_at) where status = 'pending';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  primary_market text not null check (primary_market in ('Texas', 'Florida', 'Louisiana', 'Georgia', 'North Carolina')),
  crew_size text not null,
  timezone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.signup_intents
  add constraint signup_intents_activated_workspace_fkey
  foreign key (activated_workspace_id) references public.workspaces(id) on delete set null;

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_active_idx on public.workspace_members (user_id, workspace_id) where status = 'active';

create table public.usage_policies (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (plan in ('trial', 'quarterly', 'annual')),
  trial_days integer not null default 0 check (
    (plan = 'trial' and trial_days between 1 and 30)
    or (plan <> 'trial' and trial_days = 0)
  ),
  max_members integer not null check (max_members > 0),
  max_requests_per_minute integer not null check (max_requests_per_minute > 0),
  max_daily_investigations integer not null check (max_daily_investigations > 0),
  max_concurrent_runs integer not null default 1 check (max_concurrent_runs > 0),
  max_period_cost_cents integer not null check (max_period_cost_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index usage_policies_one_active_plan_idx on public.usage_policies (plan) where active;

insert into public.usage_policies (
  plan, trial_days, max_members, max_requests_per_minute,
  max_daily_investigations, max_concurrent_runs, max_period_cost_cents
) values
  ('trial', 7, 1, 6, 25, 1, 2500),
  ('quarterly', 0, 5, 12, 100, 1, 15000),
  ('annual', 0, 10, 18, 200, 1, 50000);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan text not null check (plan in ('trial', 'quarterly', 'annual')),
  status text not null default 'active' check (status in ('active', 'expired', 'canceled', 'past_due')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  billing_customer_id text,
  billing_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index entitlements_one_active_workspace_idx on public.entitlements (workspace_id) where status = 'active';
create index entitlements_workspace_period_idx on public.entitlements (workspace_id, starts_at desc, ends_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null default 'New investigation' check (length(title) between 1 and 180),
  status text not null default 'active' check (status in ('active', 'archived')),
  context jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index conversations_workspace_recent_idx on public.conversations (workspace_id, updated_at desc);

create table public.execution_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  conversation_id uuid,
  idempotency_key text not null,
  status text not null default 'reserved' check (status in ('reserved', 'running', 'succeeded', 'failed', 'canceled')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  mcp_calls integer not null default 0 check (mcp_calls >= 0),
  estimated_cost_cents integer not null default 0 check (estimated_cost_cents >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (conversation_id, workspace_id) references public.conversations(id, workspace_id) on delete cascade
);

create index execution_runs_workspace_created_idx on public.execution_runs (workspace_id, created_at desc);
create index execution_runs_active_conversation_idx on public.execution_runs (conversation_id) where status in ('reserved', 'running');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system_event')),
  content jsonb not null,
  execution_run_id uuid references public.execution_runs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id) references public.conversations(id, workspace_id) on delete cascade
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at, id);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  type text not null check (type in ('market_ranking', 'market_comparison', 'field_plan', 'field_brief')),
  title text not null check (length(title) between 1 and 200),
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'ready', 'stale', 'archived')),
  version integer not null default 1 check (version > 0),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id) references public.conversations(id, workspace_id) on delete cascade
);

create index artifacts_workspace_recent_idx on public.artifacts (workspace_id, updated_at desc);
create index artifacts_conversation_idx on public.artifacts (conversation_id, type, version desc);

create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger usage_policies_set_updated_at before update on public.usage_policies for each row execute function public.set_updated_at();
create trigger entitlements_set_updated_at before update on public.entitlements for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger artifacts_set_updated_at before update on public.artifacts for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  );
$$;

create or replace function public.workspace_has_active_entitlement(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements
    where workspace_id = target_workspace_id
      and status = 'active'
      and starts_at <= now()
      and now() < ends_at
  );
$$;

create or replace function public.slugify_workspace_name(raw_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(raw_name, 'workspace')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.activate_trial(p_signup_intent_id uuid)
returns table (workspace_id uuid, conversation_id uuid, trial_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.signup_intents%rowtype;
  caller_email text;
  new_workspace_id uuid;
  new_conversation_id uuid;
  trial_days integer;
  trial_end timestamptz;
  base_slug text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into intent from public.signup_intents where id = p_signup_intent_id for update;

  if not found then raise exception 'Signup intent not found' using errcode = 'P0002'; end if;
  if intent.email <> caller_email then raise exception 'Verified email does not match signup intent' using errcode = '42501'; end if;

  if intent.status = 'consumed' then
    return query
      select intent.activated_workspace_id, c.id, e.ends_at
      from public.conversations c
      join public.entitlements e on e.workspace_id = intent.activated_workspace_id and e.plan = 'trial'
      where c.workspace_id = intent.activated_workspace_id
      order by c.created_at asc limit 1;
    return;
  end if;

  if intent.status <> 'pending' or intent.expires_at <= now() then
    update public.signup_intents set status = 'expired' where id = intent.id and status = 'pending';
    raise exception 'Signup intent expired' using errcode = '22023';
  end if;

  select up.trial_days into trial_days from public.usage_policies up where up.plan = 'trial' and up.active limit 1;
  trial_days := coalesce(trial_days, 7);
  trial_end := now() + make_interval(days => trial_days);
  base_slug := public.slugify_workspace_name(intent.company_name);

  insert into public.workspaces (name, slug, primary_market, crew_size)
  values (intent.company_name, base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), intent.primary_market, intent.crew_size)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new_workspace_id, auth.uid(), 'owner', 'active');

  insert into public.entitlements (workspace_id, plan, status, starts_at, ends_at)
  values (new_workspace_id, 'trial', 'active', now(), trial_end);

  insert into public.conversations (workspace_id, created_by)
  values (new_workspace_id, auth.uid()) returning id into new_conversation_id;

  update public.signup_intents set
    status = 'consumed', consumed_at = now(), activated_by = auth.uid(), activated_workspace_id = new_workspace_id
  where id = intent.id;

  return query select new_workspace_id, new_conversation_id, trial_end;
end;
$$;

alter table public.signup_intents enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.usage_policies enable row level security;
alter table public.entitlements enable row level security;
alter table public.conversations enable row level security;
alter table public.execution_runs enable row level security;
alter table public.messages enable row level security;
alter table public.artifacts enable row level security;

create policy workspaces_select_member on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspaces_update_owner on public.workspaces for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));
create policy members_select_member on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy entitlements_select_member on public.entitlements for select to authenticated using (public.is_workspace_member(workspace_id));

create policy conversations_select_member on public.conversations for select to authenticated using (public.is_workspace_member(workspace_id));
create policy conversations_insert_active_member on public.conversations for insert to authenticated with check (
  public.is_workspace_member(workspace_id)
  and public.workspace_has_active_entitlement(workspace_id)
  and created_by = auth.uid()
);
create policy conversations_update_active_member on public.conversations for update to authenticated using (
  public.is_workspace_member(workspace_id)
  and public.workspace_has_active_entitlement(workspace_id)
) with check (
  public.is_workspace_member(workspace_id)
  and public.workspace_has_active_entitlement(workspace_id)
);
create policy conversations_delete_active_owner on public.conversations for delete to authenticated using (
  public.is_workspace_owner(workspace_id)
  and public.workspace_has_active_entitlement(workspace_id)
);

create policy messages_select_member on public.messages for select to authenticated using (public.is_workspace_member(workspace_id));
create policy messages_insert_active_user on public.messages for insert to authenticated with check (
  public.is_workspace_member(workspace_id)
  and public.workspace_has_active_entitlement(workspace_id)
  and role = 'user'
  and created_by = auth.uid()
);

create policy artifacts_select_member on public.artifacts for select to authenticated using (public.is_workspace_member(workspace_id));

revoke all on public.signup_intents from anon, authenticated;
revoke all on public.usage_policies from anon, authenticated;
revoke all on public.execution_runs from anon, authenticated;
revoke insert, update, delete on public.workspace_members from authenticated;
revoke insert, update, delete on public.entitlements from authenticated;
revoke insert, update, delete on public.artifacts from authenticated;

revoke all on function public.activate_trial(uuid) from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.workspace_has_active_entitlement(uuid) from public, anon;
revoke all on function public.slugify_workspace_name(text) from public, anon, authenticated;
grant execute on function public.activate_trial(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.workspace_has_active_entitlement(uuid) to authenticated;

commit;
