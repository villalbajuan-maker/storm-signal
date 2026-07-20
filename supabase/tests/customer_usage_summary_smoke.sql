begin;

create temporary table qa_usage_customer on commit drop as
select wm.user_id, wm.workspace_id
from public.workspace_members wm
join public.entitlements e on e.workspace_id = wm.workspace_id
  and e.status = 'active' and e.ends_at > now()
where wm.status = 'active'
order by wm.created_at
limit 1;

do $$
declare
  target qa_usage_customer%rowtype;
  summary record;
begin
  select * into target from qa_usage_customer;
  if not found then raise exception 'No active QA member is available'; end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', target.user_id, 'role', 'authenticated')::text,
    true
  );

  select * into summary
  from public.get_workspace_usage_summary(target.workspace_id);

  if summary.usage_status not in ('available', 'almost_used', 'limit_reached') then
    raise exception 'Unexpected customer usage status: %', summary.usage_status;
  end if;
  if summary.usage_percentage < 0 or summary.usage_percentage > 100 then
    raise exception 'Customer percentage is not clamped: %', summary.usage_percentage;
  end if;
  if summary.warning_percentage <> 90 then
    raise exception 'Unexpected warning threshold: %', summary.warning_percentage;
  end if;
end;
$$;

rollback;
