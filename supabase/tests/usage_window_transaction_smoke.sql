begin;

create temporary table qa_target on commit drop as
select wm.user_id, wm.workspace_id, c.id conversation_id
from public.workspace_members wm
join public.entitlements e on e.workspace_id = wm.workspace_id
  and e.status = 'active' and e.starts_at <= now() and now() + interval '5 hours' < e.ends_at
join public.conversations c on c.workspace_id = wm.workspace_id
where wm.status = 'active'
order by wm.created_at
limit 1;

do $$
begin
  if not exists (select 1 from qa_target) then
    raise exception 'No active QA target is available';
  end if;
end;
$$;

create temporary table qa_reservation on commit drop as
select result.*
from qa_target target
cross join lateral public.authorize_and_reserve_usage_attempt_for_user(
  target.user_id,
  target.workspace_id,
  target.conversation_id,
  'qa-window-' || gen_random_uuid()::text,
  null::uuid,
  1,
  'qa_smoke',
  'weather_chat',
  'mini',
  'gpt-4.1',
  50000
) result;

do $$
declare
  reserved qa_reservation%rowtype;
  reconciled jsonb;
  active_window public.usage_windows%rowtype;
begin
  select * into reserved from qa_reservation;
  if reserved.result_code not in ('reserved', 'shadow_reserved') then
    raise exception 'Unexpected reservation result: %', reserved.result_code;
  end if;

  select public.reconcile_usage_attempt_for_user(
    (select user_id from qa_target), reserved.reservation_id, 'succeeded', 30000
  ) into reconciled;
  if reconciled ->> 'result_code' <> 'reconciled' then
    raise exception 'Unexpected reconciliation result: %', reconciled ->> 'result_code';
  end if;

  select * into active_window from public.usage_windows where id = reserved.window_id;
  if active_window.used_microusd <> 30000 or active_window.reserved_microusd <> 0 then
    raise exception 'Incorrect balances after reconciliation';
  end if;
  if active_window.ends_at <> active_window.started_at + interval '5 hours' then
    raise exception 'Window does not preserve the five-hour closing time';
  end if;
  if (select count(*) from public.usage_window_events where usage_window_id = active_window.id) < 3 then
    raise exception 'Expected opening, reservation and reconciliation events';
  end if;
end;
$$;

create temporary table qa_fallback on commit drop as
select result.*
from qa_target target
cross join qa_reservation first_attempt
cross join lateral public.authorize_and_reserve_usage_attempt_for_user(
  target.user_id,
  target.workspace_id,
  target.conversation_id,
  'qa-window-fallback',
  first_attempt.run_id,
  2,
  'qa_smoke',
  'field_plan',
  'frontier',
  'gpt-5.1',
  250000
) result;

do $$
declare
  fallback qa_fallback%rowtype;
  reconciled jsonb;
begin
  select * into fallback from qa_fallback;
  if fallback.result_code <> 'shadow_reserved' or not fallback.would_block then
    raise exception 'Shadow over-budget attempt was not recorded correctly';
  end if;
  select public.reconcile_usage_attempt_for_user(
    (select user_id from qa_target), fallback.reservation_id, 'canceled', 0
  ) into reconciled;
  if reconciled ->> 'result_code' <> 'reconciled' then
    raise exception 'Fallback release did not reconcile';
  end if;
end;
$$;

select public.finalize_execution_for_user(
  (select user_id from qa_target),
  (select run_id from qa_reservation),
  'succeeded', 0, 0, 0, 3, null
);

update public.usage_windows
set status = 'closed', closed_at = now()
where id = (select window_id from qa_reservation);

create temporary table qa_void on commit drop as
select result.*
from qa_target target
cross join lateral public.authorize_and_reserve_usage_attempt_for_user(
  target.user_id,
  target.workspace_id,
  target.conversation_id,
  'qa-window-void-' || gen_random_uuid()::text,
  null::uuid,
  1,
  'qa_smoke',
  'weather_chat',
  'mini',
  'gpt-4.1',
  50000
) result;

do $$
declare
  first_attempt qa_void%rowtype;
  reconciled jsonb;
  voided_status text;
begin
  select * into first_attempt from qa_void;
  select public.reconcile_usage_attempt_for_user(
    (select user_id from qa_target), first_attempt.reservation_id, 'failed_nonbillable', 0
  ) into reconciled;
  select status into voided_status from public.usage_windows where id = first_attempt.window_id;
  if voided_status <> 'voided' then
    raise exception 'Non-billable first failure did not void the empty window';
  end if;
end;
$$;

select public.finalize_execution_for_user(
  (select user_id from qa_target),
  (select run_id from qa_void),
  'failed', 0, 0, 0, 0, 'qa_nonbillable_failure'
);

create temporary table qa_terminal_first on commit drop as
select result.*
from qa_target target
cross join lateral public.authorize_and_reserve_usage_attempt_for_user(
  target.user_id,
  target.workspace_id,
  target.conversation_id,
  'qa-window-terminal-' || gen_random_uuid()::text,
  null::uuid,
  1,
  'qa_smoke',
  'weather_chat',
  'mini',
  'gpt-4.1',
  50000
) result;

select public.reconcile_usage_attempt_for_user(
  (select user_id from qa_target),
  (select reservation_id from qa_terminal_first),
  'failed_billable',
  0
);

create temporary table qa_terminal_fallback on commit drop as
select result.*
from qa_target target
cross join qa_terminal_first first_attempt
cross join lateral public.authorize_and_reserve_usage_attempt_for_user(
  target.user_id,
  target.workspace_id,
  target.conversation_id,
  'qa-window-terminal-fallback',
  first_attempt.run_id,
  2,
  'qa_smoke',
  'weather_chat',
  'frontier',
  'gpt-5.1',
  50000
) result;

select public.reconcile_usage_attempt_for_user(
  (select user_id from qa_target),
  (select reservation_id from qa_terminal_fallback),
  'failed_nonbillable',
  0
);

do $$
declare
  did_void boolean;
  final_status text;
begin
  select public.void_empty_usage_window_for_run(
    (select user_id from qa_target),
    (select run_id from qa_terminal_first)
  ) into did_void;
  select status into final_status
  from public.usage_windows
  where id = (select window_id from qa_terminal_first);
  if not did_void or final_status <> 'voided' then
    raise exception 'Multi-attempt zero-cost terminal failure did not void its empty window';
  end if;
end;
$$;

select
  r.result_code,
  r.would_block,
  w.status,
  w.budget_microusd,
  w.used_microusd,
  w.reserved_microusd,
  extract(epoch from (w.ends_at - w.started_at))::integer duration_seconds
from qa_reservation r
join public.usage_windows w on w.id = r.window_id;

rollback;
