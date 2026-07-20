begin;

create table public.trial_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

insert into public.trial_claims (user_id, workspace_id, claimed_at)
select distinct on (wm.user_id) wm.user_id, wm.workspace_id, e.starts_at
from public.workspace_members wm
join public.entitlements e on e.workspace_id = wm.workspace_id and e.plan = 'trial'
where wm.role = 'owner'
order by wm.user_id, e.starts_at asc
on conflict do nothing;

alter table public.trial_claims enable row level security;
revoke all on public.trial_claims from anon, authenticated;

create or replace function public.activate_trial(p_signup_intent_id uuid)
returns table (workspace_id uuid, conversation_id uuid, trial_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.signup_intents%rowtype;
  caller_email text;
  existing_workspace_id uuid;
  new_workspace_id uuid;
  new_conversation_id uuid;
  configured_trial_days integer;
  trial_end timestamptz;
  base_slug text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
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

  select tc.workspace_id into existing_workspace_id
  from public.trial_claims tc
  where tc.user_id = auth.uid();

  if existing_workspace_id is not null then
    update public.signup_intents set status = 'expired' where id = intent.id;
    return query
      select existing_workspace_id, c.id, e.ends_at
      from public.conversations c
      join public.entitlements e on e.workspace_id = existing_workspace_id and e.plan = 'trial'
      where c.workspace_id = existing_workspace_id
      order by c.created_at asc limit 1;
    return;
  end if;

  select up.trial_days into configured_trial_days
  from public.usage_policies up
  where up.plan = 'trial' and up.active
  limit 1;

  configured_trial_days := coalesce(configured_trial_days, 7);
  trial_end := now() + make_interval(days => configured_trial_days);
  base_slug := public.slugify_workspace_name(intent.company_name);

  insert into public.workspaces (name, slug, primary_market, crew_size)
  values (intent.company_name, base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), intent.primary_market, intent.crew_size)
  returning id into new_workspace_id;

  insert into public.trial_claims (user_id, workspace_id)
  values (auth.uid(), new_workspace_id);

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

revoke all on function public.activate_trial(uuid) from public, anon;
grant execute on function public.activate_trial(uuid) to authenticated;

commit;
