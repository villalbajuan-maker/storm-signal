begin;

create temporary table qa_audit_target on commit drop as
select wm.user_id, wm.workspace_id, e.id entitlement_id, p.id policy_id,
  p.usage_window_budget_microusd budget_microusd,
  p.usage_warning_percentage warning_percentage,
  p.usage_pricing_version pricing_version
from public.workspace_members wm
join public.entitlements e on e.workspace_id = wm.workspace_id
  and e.status = 'active' and e.ends_at > now()
join public.usage_policies p on p.plan = e.plan and p.active
where wm.status = 'active'
  and not exists (
    select 1 from public.usage_windows w
    where w.workspace_id = wm.workspace_id
      and w.status in ('open', 'warning', 'exhausted')
  )
order by wm.created_at
limit 1;

do $$ begin
  if not exists (select 1 from qa_audit_target) then
    raise exception 'No isolated QA audit target is available';
  end if;
end $$;

create temporary table qa_audit_window on commit drop as
with inserted as (
  insert into public.usage_windows (
    workspace_id, entitlement_id, usage_policy_id, opened_by, status,
    started_at, ends_at, budget_microusd, used_microusd,
    warning_percentage, pricing_version
  )
  select workspace_id, entitlement_id, policy_id, user_id, 'open',
    now(), now() + interval '5 hours', budget_microusd, 1,
    warning_percentage, pricing_version
  from qa_audit_target
  returning id, workspace_id
)
select * from inserted;

select public.run_usage_metering_audit();

do $$ begin
  if not exists (
    select 1 from public.usage_operational_alerts alert
    where alert.fingerprint = 'window_ledger_mismatch:' || (select id from qa_audit_window)
      and alert.severity = 'critical' and alert.resolved_at is null
  ) then
    raise exception 'Window ledger mismatch was not detected';
  end if;
end $$;

update public.usage_windows set used_microusd = 0
where id = (select id from qa_audit_window);

select public.run_usage_metering_audit();

do $$ begin
  if not exists (
    select 1 from public.usage_operational_alerts alert
    where alert.fingerprint = 'window_ledger_mismatch:' || (select id from qa_audit_window)
      and alert.resolved_at is not null
  ) then
    raise exception 'Cleared audit finding was not resolved';
  end if;
end $$;

rollback;
