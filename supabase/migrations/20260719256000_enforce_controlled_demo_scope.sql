create table if not exists public.mcp_coverage_states (
  state_code text primary key,
  state_fips text not null unique,
  state_name text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint mcp_coverage_states_code_format check (state_code ~ '^[A-Z]{2}$'),
  constraint mcp_coverage_states_fips_format check (state_fips ~ '^[0-9]{2}$')
);

insert into public.mcp_coverage_states (state_code, state_fips, state_name)
values
  ('TX','48','Texas'),
  ('FL','12','Florida'),
  ('LA','22','Louisiana'),
  ('GA','13','Georgia'),
  ('NC','37','North Carolina')
on conflict (state_code) do update set
  state_fips = excluded.state_fips,
  state_name = excluded.state_name,
  enabled = true;

delete from public.mcp_coverage_states
where state_code not in ('TX','FL','LA','GA','NC');

alter table public.mcp_coverage_states enable row level security;
revoke all on public.mcp_coverage_states from public, anon, authenticated;
grant select on public.mcp_coverage_states to service_role;

create or replace function public.mcp_resolve_coverage_state(p_state text)
returns text
language sql stable security invoker set search_path = ''
as $$
  select s.state_code
  from public.mcp_coverage_states s
  where s.enabled
    and (
      upper(btrim(p_state)) = s.state_code
      or btrim(p_state) = s.state_fips
      or lower(btrim(p_state)) = lower(s.state_name)
    )
  limit 1;
$$;

create or replace function public.mcp_check_coverage(
  p_state text default null,
  p_lat double precision default null,
  p_lon double precision default null
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with requested as (
  select public.mcp_resolve_coverage_state(p_state) state_code,
    case when p_lat is not null and p_lon is not null then
      extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326)::extensions.geometry
    end point
), coordinate_state as (
  select cs.state_code
  from requested r
  join public.geographic_areas ga on r.point is not null
    and ga.area_type='state' and ga.vintage=2025
    and extensions.st_covers(ga.geometry,r.point)
  join public.mcp_coverage_states cs on cs.enabled and cs.state_fips=ga.state_fips
  limit 1
), decision as (
  select r.state_code requested_state_code,
    (select state_code from coordinate_state) coordinate_state_code,
    case
      when p_state is not null and r.state_code is null then 'out_of_coverage'
      when r.point is not null and not exists (select 1 from coordinate_state) then 'out_of_coverage'
      when r.state_code is not null and r.point is not null
        and r.state_code is distinct from (select state_code from coordinate_state) then 'location_mismatch'
      else 'in_coverage'
    end status
  from requested r
)
select jsonb_build_object(
  'status',d.status,
  'requested_state',p_state,
  'requested_state_code',d.requested_state_code,
  'coordinate_state_code',d.coordinate_state_code,
  'scope_defaulted',p_state is null and p_lat is null and p_lon is null,
  'covered_states',(select jsonb_agg(jsonb_build_object(
    'state_code',s.state_code,'state_fips',s.state_fips,'name',s.state_name
  ) order by s.state_code) from public.mcp_coverage_states s where s.enabled),
  'message','This location is not yet part of Storm Signal''s controlled demo coverage. We currently provide commercial analysis for Texas, Florida, Louisiana, Georgia, and North Carolina. Coverage for additional states is coming soon.'
) from decision d;
$$;

create or replace function public.mcp_search_storm_events(
  p_start_at timestamptz default null, p_end_at timestamptz default null,
  p_event_types text[] default null, p_state text default null,
  p_county text default null, p_place text default null, p_zcta text default null,
  p_min_hail_inches numeric default null, p_status text default null,
  p_lat double precision default null, p_lon double precision default null,
  p_radius_miles double precision default null, p_limit integer default 50
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with scope as (
  select public.mcp_resolve_coverage_state(p_state) requested_state,
    public.mcp_check_coverage(p_state,p_lat,p_lon)->>'status' coverage_status,
    greatest(coalesce(p_start_at,now()-interval '14 days'),now()-interval '14 days') effective_start,
    coalesce(p_end_at,now()) effective_end
), origin as (
  select case when p_lat is not null and p_lon is not null then
    extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326)::extensions.geometry
  end point
), matches as (
  select e.*,case when o.point is not null and e.centroid is not null then
    extensions.st_distance(e.centroid::extensions.geography,o.point::extensions.geography)/1609.344
  end distance_miles
  from public.storm_events e cross join origin o cross join scope s
  join public.mcp_coverage_states cs on cs.enabled and upper(e.state)=cs.state_code
  where s.coverage_status='in_coverage'
    and e.started_at>=s.effective_start and e.started_at<=s.effective_end
    and (p_event_types is null or e.event_type=any(p_event_types))
    and (p_state is null or cs.state_code=s.requested_state)
    and (p_county is null or upper(coalesce(e.county,''))=upper(p_county) or exists (
      select 1 from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id
      where sea.storm_event_id=e.id and sea.method_version='census-postgis-v1' and ga.vintage=2025
        and ga.area_type='county' and upper(regexp_replace(ga.name,'\s+(County|Parish)$','','i'))=upper(regexp_replace(p_county,'\s+(County|Parish)$','','i'))))
    and (p_place is null or exists (select 1 from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=e.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='place' and upper(ga.name)=upper(p_place)))
    and (p_zcta is null or exists (select 1 from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=e.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='zcta' and ga.zcta5=btrim(p_zcta)))
    and (p_min_hail_inches is null or e.magnitude>=p_min_hail_inches)
    and (p_status is null or lower(e.status)=lower(p_status))
    and (o.point is null or (e.centroid is not null and extensions.st_dwithin(e.centroid::extensions.geography,o.point::extensions.geography,coalesce(p_radius_miles,10)*1609.344)))
  order by e.started_at desc limit least(greatest(coalesce(p_limit,50),1),200)
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'event_type',event_type,'status',status,'started_at',started_at,'ended_at',ended_at,
  'magnitude',magnitude,'magnitude_unit',magnitude_unit,'severity',severity,'urgency',urgency,'certainty',certainty,
  'state',state,'county',county,'source',source,'source_record_id',source_record_id,'source_url',source_url,
  'geometry',case when geometry is null then null else extensions.st_asgeojson(geometry)::jsonb end,
  'centroid',case when centroid is null then null else extensions.st_asgeojson(centroid)::jsonb end,
  'distance_miles',case when distance_miles is null then null else round(distance_miles::numeric,2) end,
  'geography',jsonb_build_object(
    'states',(select coalesce(jsonb_agg(distinct ga.name),'[]'::jsonb) from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=matches.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='state'),
    'counties',(select coalesce(jsonb_agg(distinct ga.name),'[]'::jsonb) from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=matches.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='county'),
    'places',(select coalesce(jsonb_agg(distinct ga.name),'[]'::jsonb) from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=matches.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='place'),
    'zctas',(select coalesce(jsonb_agg(distinct ga.zcta5),'[]'::jsonb) from public.storm_event_areas sea join public.geographic_areas ga on ga.id=sea.geographic_area_id where sea.storm_event_id=matches.id and sea.method_version='census-postgis-v1' and ga.vintage=2025 and ga.area_type='zcta'),
    'vintage',2025,'method_version','census-postgis-v1','zcta_interpretation','ZCTA is an approximate ZIP area from Census geography, not a USPS delivery boundary.')) order by started_at desc),'[]'::jsonb)
from matches;
$$;

create or replace function public.mcp_get_storm_event(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'event',jsonb_build_object('id',e.id,'event_type',e.event_type,'status',e.status,'started_at',e.started_at,'ended_at',e.ended_at,'magnitude',e.magnitude,'magnitude_unit',e.magnitude_unit,'severity',e.severity,'urgency',e.urgency,'certainty',e.certainty,'state',e.state,'county',e.county,'source',e.source,'source_record_id',e.source_record_id,'source_url',e.source_url,'geometry',case when e.geometry is null then null else extensions.st_asgeojson(e.geometry)::jsonb end,'centroid',case when e.centroid is null then null else extensions.st_asgeojson(e.centroid)::jsonb end),
  'source_versions',coalesce((select jsonb_agg(jsonb_build_object('retrieved_at',r.retrieved_at,'payload_hash',r.payload_hash,'source_url',r.source_url,'payload',r.payload_json) order by r.retrieved_at desc) from public.source_records r where r.source=e.source and r.source_record_id=e.source_record_id),'[]'::jsonb))
from public.storm_events e
join public.mcp_coverage_states cs on cs.enabled and upper(e.state)=cs.state_code
where e.id=p_event_id;
$$;

create or replace function public.mcp_summarize_storm_activity(
  p_start_at timestamptz,p_end_at timestamptz,p_group_by text default 'event_type',
  p_state text default null,p_event_types text[] default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with scope as (select public.mcp_resolve_coverage_state(p_state) requested_state), filtered as (
  select e.*,case p_group_by when 'state' then coalesce(e.state,'unknown') when 'county' then coalesce(e.county,'unknown') when 'day' then to_char(e.started_at at time zone 'UTC','YYYY-MM-DD') else e.event_type end group_key
  from public.storm_events e cross join scope s
  join public.mcp_coverage_states cs on cs.enabled and upper(e.state)=cs.state_code
  where e.started_at>=greatest(p_start_at,now()-interval '14 days') and e.started_at<=least(p_end_at,now())
    and (p_state is null or (s.requested_state is not null and cs.state_code=s.requested_state))
    and (p_event_types is null or e.event_type=any(p_event_types))
), grouped as (
  select group_key,count(*) event_count,count(*) filter(where event_type in ('hail_report','historical_hail_event')) hail_report_count,count(*) filter(where event_type='wind_report') wind_report_count,count(*) filter(where event_type='tornado_report') tornado_report_count,max(magnitude) filter(where event_type in ('hail_report','historical_hail_event') and magnitude_unit='inch') max_hail_inches,max(magnitude) filter(where event_type='wind_report' and magnitude_unit='mph') max_wind_mph,max(started_at) latest_event_at
  from filtered group by group_key)
select coalesce(jsonb_agg(jsonb_build_object('group',group_key,'event_count',event_count,'hail_report_count',hail_report_count,'wind_report_count',wind_report_count,'tornado_report_count',tornado_report_count,'max_hail_inches',max_hail_inches,'max_wind_mph',max_wind_mph,'latest_event_at',latest_event_at) order by event_count desc,group_key),'[]'::jsonb) from grouped;
$$;

alter function public.mcp_data_health() rename to mcp_data_health_unscoped;

create function public.mcp_data_health()
returns jsonb language sql stable security invoker set search_path = '' as $$
with base as (select public.mcp_data_health_unscoped() value), covered_events as (
  select e.* from public.storm_events e join public.mcp_coverage_states cs on cs.enabled and upper(e.state)=cs.state_code
  where e.started_at>=now()-interval '14 days'
), coverage as (
  select jsonb_build_object('states_with_any_events',count(distinct state) filter(where state is not null),'states_with_recent_reports',count(distinct state) filter(where source='spc_reports' and started_at>=now()-interval '48 hours' and state is not null),'states_with_historical_events',count(distinct state) filter(where source='noaa_storm_events' and state is not null),'earliest_event_at',min(started_at),'latest_event_at',max(started_at),'event_count',count(*),'scope','controlled_demo_five_states','window_days',14) value from covered_events
), processing as (
  select jsonb_build_object('total_events',count(*),'complete',count(*) filter(where s.status='complete'),'partial',count(*) filter(where s.status='partial'),'insufficient_geometry',count(*) filter(where s.status='insufficient_geometry'),'pending',count(*) filter(where s.storm_event_id is null)) value
  from covered_events e left join public.storm_event_geospatial_status s on s.storm_event_id=e.id and s.vintage=2025 and s.method_version='census-postgis-v1'
)
select jsonb_set(jsonb_set(base.value,'{coverage}',coverage.value,true),'{geography,event_processing}',processing.value,true) from base,coverage,processing;
$$;

revoke all on function public.mcp_resolve_coverage_state(text) from public,anon,authenticated;
revoke all on function public.mcp_check_coverage(text,double precision,double precision) from public,anon,authenticated;
revoke all on function public.mcp_data_health_unscoped() from public,anon,authenticated;
revoke all on function public.mcp_data_health() from public,anon,authenticated;
grant execute on function public.mcp_resolve_coverage_state(text) to service_role;
grant execute on function public.mcp_check_coverage(text,double precision,double precision) to service_role;
grant execute on function public.mcp_data_health_unscoped() to service_role;
grant execute on function public.mcp_data_health() to service_role;
