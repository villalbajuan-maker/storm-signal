begin;

create temporary table qa_enforcement_target on commit drop as
select wm.user_id, wm.workspace_id, c.id conversation_id
from public.workspace_members wm
join public.entitlements e on e.workspace_id = wm.workspace_id
  and e.status = 'active' and e.ends_at > now() + interval '6 hours'
join public.conversations c on c.workspace_id = wm.workspace_id
where wm.status = 'active'
  and not exists (
    select 1 from public.usage_windows w
    where w.workspace_id = wm.workspace_id
      and w.status in ('open', 'warning', 'exhausted')
  )
order by wm.created_at
limit 1;

do $$ begin
  if not exists (select 1 from qa_enforcement_target) then
    raise exception 'No isolated controlled-enforcement target is available';
  end if;
end $$;

update public.usage_policies
set usage_window_mode = 'enforced'
where plan = 'trial' and active;

create temporary table qa_warning_attempt on commit drop as
select result.*
from qa_enforcement_target target
cross join lateral public.reserve_usage_attempt_for_user(
  target.user_id, target.workspace_id, target.conversation_id,
  'qa-enforced-warning-' || gen_random_uuid()::text, null::uuid, 1,
  'weather_chat', 'mini', 'qa-model', 250000
) result;

select public.reconcile_usage_attempt_for_user(
  (select user_id from qa_enforcement_target),
  (select reservation_id from qa_warning_attempt),
  'succeeded', 243000
);

do $$
declare summary record;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', (select user_id from qa_enforcement_target), 'role', 'authenticated')::text,
    true
  );
  select * into summary from public.get_workspace_usage_summary((select workspace_id from qa_enforcement_target));
  if summary.usage_status <> 'almost_used' or summary.usage_percentage <> 90 or not summary.enforcement_active then
    raise exception 'Warning customer state failed: %, %, %', summary.usage_status, summary.usage_percentage, summary.enforcement_active;
  end if;
end;
$$;

select public.finalize_execution_for_user(
  (select user_id from qa_enforcement_target),
  (select run_id from qa_warning_attempt),
  'succeeded', 0, 0, 0, 25, null
);

create temporary table qa_exhaust_attempt on commit drop as
select result.*
from qa_enforcement_target target
cross join lateral public.reserve_usage_attempt_for_user(
  target.user_id, target.workspace_id, target.conversation_id,
  'qa-enforced-exhaust-' || gen_random_uuid()::text, null::uuid, 1,
  'weather_chat', 'mini', 'qa-model', 20000
) result;

select public.reconcile_usage_attempt_for_user(
  (select user_id from qa_enforcement_target),
  (select reservation_id from qa_exhaust_attempt),
  'succeeded', 30000
);

select public.finalize_execution_for_user(
  (select user_id from qa_enforcement_target),
  (select run_id from qa_exhaust_attempt),
  'succeeded', 0, 0, 0, 3, null
);

create temporary table qa_blocked_attempt on commit drop as
select result.*
from qa_enforcement_target target
cross join lateral public.reserve_usage_attempt_for_user(
  target.user_id, target.workspace_id, target.conversation_id,
  'qa-enforced-block-' || gen_random_uuid()::text, null::uuid, 1,
  'weather_chat', 'mini', 'qa-model', 10000
) result;

do $$
declare summary record;
begin
  if (select result_code from qa_blocked_attempt) <> 'window_limit'
    or not (select would_block from qa_blocked_attempt)
    or (select reservation_id from qa_blocked_attempt) is not null then
    raise exception 'Enforced window did not reject provider work';
  end if;
  select * into summary from public.get_workspace_usage_summary((select workspace_id from qa_enforcement_target));
  if summary.usage_status <> 'limit_reached' or summary.usage_percentage <> 100 then
    raise exception 'Exhausted customer state failed: %, %', summary.usage_status, summary.usage_percentage;
  end if;
end;
$$;

update public.usage_windows
set started_at = now() - interval '5 hours 2 seconds',
    ends_at = now() - interval '1 second'
where id = (select window_id from qa_warning_attempt);

create temporary table qa_reopened_attempt on commit drop as
select result.*
from qa_enforcement_target target
cross join lateral public.reserve_usage_attempt_for_user(
  target.user_id, target.workspace_id, target.conversation_id,
  'qa-enforced-reopen-' || gen_random_uuid()::text, null::uuid, 1,
  'weather_chat', 'mini', 'qa-model', 10000
) result;

do $$ begin
  if (select result_code from qa_reopened_attempt) <> 'reserved'
    or (select window_id from qa_reopened_attempt) = (select window_id from qa_warning_attempt) then
    raise exception 'Fixed-boundary reopening failed';
  end if;
end $$;

select
  (select result_code from qa_warning_attempt) warning_reservation,
  (select result_code from qa_exhaust_attempt) exhaust_reservation,
  (select result_code from qa_blocked_attempt) blocked_result,
  (select result_code from qa_reopened_attempt) reopened_result;

rollback;
