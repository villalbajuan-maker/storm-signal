create table if not exists public.geographic_coverage_summary (
  vintage integer not null,
  method_version text not null,
  state_fips text not null,
  state_code text not null,
  state_name text not null,
  counties integer not null,
  places integer not null,
  intersecting_zctas integer not null,
  audited_at timestamptz not null default now(),
  primary key (vintage, method_version, state_fips)
);

insert into public.geographic_coverage_summary
  (vintage, method_version, state_fips, state_code, state_name, counties, places, intersecting_zctas)
values
  (2025,'census-postgis-v1','08','CO','Colorado',64,482,567),
  (2025,'census-postgis-v1','12','FL','Florida',67,958,1024),
  (2025,'census-postgis-v1','13','GA','Georgia',159,676,842),
  (2025,'census-postgis-v1','20','KS','Kansas',105,740,771),
  (2025,'census-postgis-v1','22','LA','Louisiana',64,484,577),
  (2025,'census-postgis-v1','29','MO','Missouri',115,1081,1154),
  (2025,'census-postgis-v1','30','MT','Montana',56,497,393),
  (2025,'census-postgis-v1','31','NE','Nebraska',93,593,669),
  (2025,'census-postgis-v1','37','NC','North Carolina',100,776,919),
  (2025,'census-postgis-v1','40','OK','Oklahoma',77,846,744),
  (2025,'census-postgis-v1','45','SC','South Carolina',46,475,462),
  (2025,'census-postgis-v1','48','TX','Texas',254,1863,2073)
on conflict (vintage, method_version, state_fips) do update set
  state_code = excluded.state_code,
  state_name = excluded.state_name,
  counties = excluded.counties,
  places = excluded.places,
  intersecting_zctas = excluded.intersecting_zctas,
  audited_at = now();

alter table public.geographic_coverage_summary enable row level security;
revoke all on public.geographic_coverage_summary from public, anon, authenticated;
grant select on public.geographic_coverage_summary to service_role;

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
    'earliest_event_at', min(started_at), 'latest_event_at', max(started_at), 'event_count', count(*)
  ) value from public.storm_events
), event_geography as (
  select count(*) total_events,
    count(*) filter (where s.status = 'complete') complete,
    count(*) filter (where s.status = 'partial') partial,
    count(*) filter (where s.status = 'insufficient_geometry') insufficient_geometry,
    count(*) filter (where s.storm_event_id is null) pending
  from public.storm_events e
  left join public.storm_event_geospatial_status s
    on s.storm_event_id = e.id and s.vintage = 2025 and s.method_version = 'census-postgis-v1'
), latest_ingestion_geography as (
  select l.source, l.started_at, l.geographic_status,
    l.geographic_events_processed, l.geographic_associations, l.geographic_error_message
  from latest l where l.source in ('nws_alerts', 'spc_reports')
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
    'queue_status', case when eg.pending > 0 or exists (
      select 1 from latest_ingestion_geography where geographic_status = 'failed'
    ) then 'degraded' else 'healthy' end,
    'vintage', 2025, 'method_version', 'census-postgis-v1',
    'covered_state_count', (select count(*) from public.geographic_coverage_summary
      where vintage = 2025 and method_version = 'census-postgis-v1'),
    'covered_states', coalesce((select jsonb_agg(jsonb_build_object(
      'state_code', state_code, 'state_fips', state_fips, 'name', state_name,
      'counties', counties, 'places', places, 'intersecting_zctas', intersecting_zctas,
      'audited_at', audited_at
    ) order by state_code) from public.geographic_coverage_summary
      where vintage = 2025 and method_version = 'census-postgis-v1'), '[]'::jsonb),
    'event_processing', jsonb_build_object(
      'total_events', eg.total_events, 'complete', eg.complete, 'partial', eg.partial,
      'insufficient_geometry', eg.insufficient_geometry, 'pending', eg.pending),
    'latest_ingestion', coalesce((select jsonb_agg(to_jsonb(lig) order by lig.source)
      from latest_ingestion_geography lig), '[]'::jsonb),
    'alerts', (select value from geography_alerts),
    'interpretation', 'Partial means geographic processing completed without all required state, county, and ZCTA associations; it is not a processing failure.'
  ) value from event_geography eg
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
