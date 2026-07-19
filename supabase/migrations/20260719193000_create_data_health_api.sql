-- MCP-visible freshness and coverage contract. A zero-result query is only
-- meaningful when the underlying sources are known to be healthy and covered.
create or replace function public.mcp_data_health()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with expected(source, expected_minutes) as (
  values ('nws_alerts'::text, 5), ('spc_reports'::text, 10), ('noaa_storm_events'::text, 10080)
), latest as (
  select distinct on (r.source)
    r.source, r.status, r.started_at, r.completed_at, r.records_received,
    r.records_created, r.records_updated, r.error_message
  from public.ingestion_runs r
  order by r.source, r.started_at desc
), source_health as (
  select e.source, e.expected_minutes,
    l.status as latest_status, l.started_at as latest_started_at,
    l.completed_at as latest_completed_at, l.records_received,
    l.records_created, l.records_updated, l.error_message,
    case when l.completed_at is null then null
      else round((extract(epoch from (now() - l.completed_at)) / 60)::numeric, 1)
    end as minutes_since_completion,
    case
      when l.source is null then 'never_ingested'
      when l.status <> 'complete' then 'unhealthy'
      when l.completed_at < now() - make_interval(mins => e.expected_minutes * 3) then 'stale'
      else 'fresh'
    end as freshness_status
  from expected e left join latest l using (source)
), coverage as (
  select jsonb_build_object(
    'states_with_any_events', count(distinct state) filter (where state is not null),
    'states_with_recent_reports', count(distinct state) filter (
      where source = 'spc_reports' and started_at >= now() - interval '48 hours' and state is not null),
    'states_with_historical_events', count(distinct state) filter (
      where source = 'noaa_storm_events' and state is not null),
    'earliest_event_at', min(started_at),
    'latest_event_at', max(started_at),
    'event_count', count(*)
  ) value from public.storm_events
)
select jsonb_build_object(
  'checked_at', now(),
  'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from source_health s), '[]'::jsonb),
  'coverage', (select value from coverage),
  'interpretation', 'No matching events means no evidence was found in persisted coverage; it is not proof that no weather occurred.'
);
$$;

revoke execute on function public.mcp_data_health() from public, anon, authenticated;
grant execute on function public.mcp_data_health() to service_role;
