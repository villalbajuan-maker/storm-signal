create or replace function public.mcp_data_health()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with expected(source, expected_minutes) as (
  values ('nws_alerts'::text, 5), ('spc_reports'::text, 10), ('noaa_storm_events'::text, 10080)
), latest as (
  select distinct on (r.source)
    r.source, r.status, r.started_at, r.completed_at, r.records_received,
    r.records_created, r.records_updated, r.error_message,
    r.geographic_status, r.geographic_events_processed,
    r.geographic_associations, r.geographic_error_message
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
), commercial_states(state_fips, state_code) as (
  values ('08','CO'),('12','FL'),('13','GA'),('20','KS'),('22','LA'),('29','MO'),
         ('30','MT'),('31','NE'),('37','NC'),('40','OK'),('45','SC'),('48','TX')
), covered_states as (
  select cs.state_code, cs.state_fips, ga.name,
    (select count(*) from public.geographic_areas c
      where c.vintage = 2025 and c.area_type = 'county' and c.state_fips = cs.state_fips) counties,
    (select count(*) from public.geographic_areas p
      where p.vintage = 2025 and p.area_type = 'place' and p.state_fips = cs.state_fips) places,
    (select count(*) from public.geographic_areas z
      where z.vintage = 2025 and z.area_type = 'zcta'
        and extensions.st_intersects(z.geometry, ga.geometry)) intersecting_zctas
  from commercial_states cs
  join public.geographic_areas ga
    on ga.vintage = 2025 and ga.area_type = 'state' and ga.geoid = cs.state_fips
), event_geography as (
  select
    count(*) total_events,
    count(*) filter (where s.status = 'complete') complete,
    count(*) filter (where s.status = 'partial') partial,
    count(*) filter (where s.status = 'insufficient_geometry') insufficient_geometry,
    count(*) filter (where s.storm_event_id is null) pending
  from public.storm_events e
  left join public.storm_event_geospatial_status s
    on s.storm_event_id = e.id and s.vintage = 2025
   and s.method_version = 'census-postgis-v1'
), latest_ingestion_geography as (
  select l.source, l.started_at, l.geographic_status,
    l.geographic_events_processed, l.geographic_associations,
    l.geographic_error_message
  from latest l
  where l.source in ('nws_alerts', 'spc_reports')
), geography_alerts as (
  select coalesce(jsonb_agg(message order by priority, message), '[]'::jsonb) value
  from (
    select 1 priority, 'Geographic processing queue is not empty.' message
    from event_geography where pending > 0
    union all
    select 2 priority, source || ' latest geographic phase failed: ' || coalesce(geographic_error_message, 'unknown error') message
    from latest_ingestion_geography where geographic_status = 'failed'
  ) alerts
), geography as (
  select jsonb_build_object(
    'queue_status', case
      when eg.pending > 0 or exists (select 1 from latest_ingestion_geography where geographic_status = 'failed')
        then 'degraded' else 'healthy' end,
    'vintage', 2025,
    'method_version', 'census-postgis-v1',
    'covered_state_count', (select count(*) from covered_states),
    'covered_states', coalesce((select jsonb_agg(jsonb_build_object(
      'state_code', state_code, 'state_fips', state_fips, 'name', name,
      'counties', counties, 'places', places, 'intersecting_zctas', intersecting_zctas
    ) order by state_code) from covered_states), '[]'::jsonb),
    'event_processing', jsonb_build_object(
      'total_events', eg.total_events, 'complete', eg.complete, 'partial', eg.partial,
      'insufficient_geometry', eg.insufficient_geometry, 'pending', eg.pending
    ),
    'latest_ingestion', coalesce((select jsonb_agg(to_jsonb(lig) order by lig.source)
      from latest_ingestion_geography lig), '[]'::jsonb),
    'alerts', (select value from geography_alerts),
    'interpretation', 'Partial means geographic processing completed without all required state, county, and ZCTA associations; it is not a processing failure.'
  ) value
  from event_geography eg
)
select jsonb_build_object(
  'checked_at', now(),
  'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from source_health s), '[]'::jsonb),
  'coverage', (select value from coverage),
  'geography', (select value from geography),
  'interpretation', 'No matching events means no evidence was found in persisted coverage; it is not proof that no weather occurred.'
);
$$;

revoke execute on function public.mcp_data_health() from public, anon, authenticated;
grant execute on function public.mcp_data_health() to service_role;
