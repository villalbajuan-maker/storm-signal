create or replace function public.mcp_check_event_coverage(p_event_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with event_state as (
  select e.state,cs.state_code
  from public.storm_events e
  left join public.mcp_coverage_states cs on cs.enabled and upper(e.state)=cs.state_code
  where e.id=p_event_id
)
select case
  when not exists(select 1 from event_state) then jsonb_build_object(
    'status','not_found','event_id',p_event_id,
    'covered_states',(select jsonb_agg(jsonb_build_object('state_code',s.state_code,'state_fips',s.state_fips,'name',s.state_name) order by s.state_code) from public.mcp_coverage_states s where s.enabled))
  when (select state_code from event_state) is null then jsonb_build_object(
    'status','out_of_coverage','event_id',p_event_id,'requested_state',(select state from event_state),
    'covered_states',(select jsonb_agg(jsonb_build_object('state_code',s.state_code,'state_fips',s.state_fips,'name',s.state_name) order by s.state_code) from public.mcp_coverage_states s where s.enabled))
  else jsonb_build_object(
    'status','in_coverage','event_id',p_event_id,'requested_state',(select state from event_state),'requested_state_code',(select state_code from event_state),
    'covered_states',(select jsonb_agg(jsonb_build_object('state_code',s.state_code,'state_fips',s.state_fips,'name',s.state_name) order by s.state_code) from public.mcp_coverage_states s where s.enabled))
end;
$$;

revoke all on function public.mcp_check_event_coverage(uuid) from public,anon,authenticated;
grant execute on function public.mcp_check_event_coverage(uuid) to service_role;
