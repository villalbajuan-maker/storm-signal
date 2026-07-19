-- Expose the frozen NHC contract through one dedicated read-only MCP RPC and
-- add NHC-specific observability without mixing forecasts into storm_events.

create or replace function public.mcp_search_tropical_cyclones(
  p_active_only boolean default true,
  p_atcf_id text default null,
  p_issued_after timestamptz default null,
  p_issued_before timestamptz default null,
  p_product_types text[] default null,
  p_evidence_classes text[] default null,
  p_state text default null,
  p_county text default null,
  p_place text default null,
  p_zcta text default null,
  p_valid_at timestamptz default null,
  p_limit integer default 50
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with requested as (
  select public.mcp_resolve_coverage_state(p_state) state_code
), filtered as (
  select c.id cyclone_id, c.atcf_id, c.basin, c.season_year, c.current_name,
    c.current_classification, c.active, c.first_advisory_at, c.last_advisory_at,
    a.id advisory_id, a.advisory_label, a.advisory_kind, a.issued_at,
    a.status advisory_status, a.classification, a.storm_name, a.maximum_wind_kt,
    a.minimum_pressure_mb, a.movement_direction_degrees, a.movement_speed_kt,
    a.headline, f.id feature_id, f.product_type, f.evidence_class,
    f.product_status, f.forecast_hour, f.valid_at, f.threshold_kt,
    f.probability_percent, f.watch_warning_type, f.geographic_status,
    extensions.st_geometrytype(f.geometry) geometry_type,
    r.source_url, r.retrieved_at, r.payload_hash, r.id source_record_id
  from public.tropical_cyclones c
  join public.cyclone_advisories a on a.cyclone_id = c.id
  join public.cyclone_features f on f.advisory_id = a.id and f.is_current
  join public.source_records r on r.id = f.source_record_id
  cross join requested q
  where (not p_active_only or c.active)
    and (p_atcf_id is null or c.atcf_id = upper(p_atcf_id))
    and (p_issued_after is null or a.issued_at >= p_issued_after)
    and (p_issued_before is null or a.issued_at <= p_issued_before)
    and (p_product_types is null or f.product_type = any(p_product_types))
    and (p_evidence_classes is null or f.evidence_class = any(p_evidence_classes))
    and (p_valid_at is null or f.valid_at = p_valid_at)
    and exists (
      select 1
      from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      join public.mcp_coverage_states cs
        on cs.enabled and ga.area_type = 'state' and ga.state_fips = cs.state_fips
      where cfa.cyclone_feature_id = f.id
        and (p_state is null or (q.state_code is not null and cs.state_code = q.state_code))
    )
    and (p_county is null or exists (
      select 1 from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      where cfa.cyclone_feature_id = f.id and ga.area_type = 'county'
        and regexp_replace(lower(ga.name), '\s+(county|parish)$', '') =
            regexp_replace(lower(p_county), '\s+(county|parish)$', '')
    ))
    and (p_place is null or exists (
      select 1 from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      where cfa.cyclone_feature_id = f.id and ga.area_type = 'place'
        and lower(ga.name) = lower(p_place)
    ))
    and (p_zcta is null or exists (
      select 1 from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      where cfa.cyclone_feature_id = f.id and ga.area_type = 'zcta' and ga.zcta5 = p_zcta
    ))
  order by a.issued_at desc, f.valid_at nulls first, f.product_type, f.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
), presented as (
  select x.*,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'area_type', ga.area_type, 'name', ga.name, 'geoid', ga.geoid,
        'state_fips', ga.state_fips, 'zcta5', ga.zcta5,
        'relation', cfa.relation, 'intersection_ratio', cfa.intersection_ratio,
        'vintage', ga.vintage, 'method_version', cfa.method_version
      ) order by case ga.area_type when 'state' then 1 when 'county' then 2 when 'place' then 3 else 4 end, ga.name)
      from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      where cfa.cyclone_feature_id = x.feature_id
        and (ga.area_type <> 'state' or exists (
          select 1 from public.mcp_coverage_states cs
          where cs.enabled and cs.state_fips = ga.state_fips
        ))
    ), '[]'::jsonb) geographies
  from filtered x
)
select coalesce(jsonb_agg(jsonb_build_object(
  'cyclone', jsonb_build_object(
    'id', cyclone_id, 'atcf_id', atcf_id, 'basin', basin,
    'season_year', season_year, 'name', current_name,
    'classification', current_classification, 'active', active,
    'first_advisory_at', first_advisory_at, 'last_advisory_at', last_advisory_at
  ),
  'advisory', jsonb_build_object(
    'id', advisory_id, 'label', advisory_label, 'kind', advisory_kind,
    'issued_at', issued_at, 'status', advisory_status,
    'classification', classification, 'storm_name', storm_name,
    'maximum_wind_kt', maximum_wind_kt, 'minimum_pressure_mb', minimum_pressure_mb,
    'movement_direction_degrees', movement_direction_degrees,
    'movement_speed_kt', movement_speed_kt, 'headline', headline
  ),
  'feature', jsonb_build_object(
    'id', feature_id, 'product_type', product_type,
    'evidence_class', evidence_class, 'product_status', product_status,
    'forecast_hour', forecast_hour, 'valid_at', valid_at,
    'threshold_kt', threshold_kt, 'probability_percent', probability_percent,
    'watch_warning_type', watch_warning_type, 'geometry_type', geometry_type,
    'geographic_status', geographic_status
  ),
  'source', jsonb_build_object(
    'source_record_id', source_record_id, 'source_url', source_url,
    'retrieved_at', retrieved_at, 'payload_hash', payload_hash
  ),
  'geographies', geographies,
  'interpretation', case
    when product_type in ('operational_cone','experimental_cone') then
      'Within the cone means the territory intersects forecast-track uncertainty; it is not a storm-size or impact footprint.'
    when product_type = 'watch_warning' then
      'The territory intersects an official coastal watch or warning segment; this does not prove impact.'
    when product_type = 'wind_radius' then
      'The polygon is a forecast or analyzed maximum wind extent for the stated threshold; wind is not uniform inside it.'
    when evidence_class = 'forecast' then
      'This is an NHC forecast valid at the stated time, not an observation.'
    else 'This evidence retains its explicit NHC evidence class and must not be interpreted as property impact.'
  end
) order by issued_at desc, valid_at nulls first, product_type, feature_id), '[]'::jsonb)
from presented;
$$;

alter function public.mcp_data_health() rename to mcp_data_health_without_nhc;

create function public.mcp_data_health()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with base as (
  select public.mcp_data_health_without_nhc() value
), latest_run as (
  select r.* from public.ingestion_runs r
  where r.source = 'nhc_gis'
  order by r.started_at desc limit 1
), latest_success as (
  select r.* from public.ingestion_runs r
  where r.source = 'nhc_gis' and r.status = 'complete'
  order by r.completed_at desc nulls last limit 1
), latest_advisories as (
  select c.id cyclone_id, c.atcf_id, c.current_name, c.current_classification,
    c.active, a.id advisory_id, a.advisory_label, a.issued_at,
    row_number() over (partition by c.id order by a.issued_at desc, a.created_at desc) rn
  from public.tropical_cyclones c
  join public.cyclone_advisories a on a.cyclone_id = c.id
), current_features as (
  select f.* from public.cyclone_features f
  join latest_advisories la on la.advisory_id = f.advisory_id and la.rn = 1
  where f.is_current
), feature_health as (
  select count(*) feature_count,
    count(*) filter (where geographic_status = 'not_processed') unenriched_features,
    count(*) filter (where geographic_status = 'partial') partial_features,
    count(*) filter (where geographic_status = 'failed') failed_features,
    coalesce(jsonb_agg(distinct product_type) filter (where product_type is not null), '[]'::jsonb) received_product_types
  from current_features
), nhc as (
  select jsonb_build_object(
    'source', 'nhc_gis',
    'state', case
      when lr.id is null then 'failed'
      when lr.status <> 'complete' then 'failed'
      when lr.completed_at < now() - interval '15 minutes' then 'degraded'
      when fh.failed_features > 0 or fh.partial_features > 0 or fh.unenriched_features > 0 then 'degraded'
      when (select count(*) from public.tropical_cyclones where active) > 0 then 'active'
      else 'seasonally_empty'
    end,
    'last_poll_at', lr.completed_at,
    'last_poll_status', lr.status,
    'last_successful_poll_at', ls.completed_at,
    'minutes_since_successful_poll', case when ls.completed_at is null then null
      else round((extract(epoch from (now() - ls.completed_at)) / 60)::numeric, 1) end,
    'active_cyclones_discovered', (select count(*) from public.tropical_cyclones where active),
    'latest_advisories', coalesce((select jsonb_agg(jsonb_build_object(
      'atcf_id', atcf_id, 'name', current_name, 'classification', current_classification,
      'active', active, 'advisory_label', advisory_label, 'issued_at', issued_at
    ) order by issued_at desc) from latest_advisories where rn = 1), '[]'::jsonb),
    'phase1_product_types', jsonb_build_array(
      'analysis_center', 'forecast_track_point', 'operational_cone', 'watch_warning', 'wind_radius'),
    'received_product_types', fh.received_product_types,
    'current_feature_count', fh.feature_count,
    'unenriched_features', fh.unenriched_features,
    'partial_features', fh.partial_features,
    'failed_features', fh.failed_features,
    'latest_run', case when lr.id is null then null else jsonb_build_object(
      'id', lr.id, 'started_at', lr.started_at, 'completed_at', lr.completed_at,
      'status', lr.status, 'records_received', lr.records_received,
      'geographic_status', lr.geographic_status,
      'geographic_events_processed', lr.geographic_events_processed,
      'geographic_associations', lr.geographic_associations,
      'error_message', lr.error_message,
      'geographic_error_message', lr.geographic_error_message
    ) end,
    'oldest_active_advisory_age_minutes', (
      select round((extract(epoch from (now() - min(first_advisory_at))) / 60)::numeric, 1)
      from public.tropical_cyclones where active),
    'interpretation', 'NHC forecasts, cones, watches, warnings and wind fields are not observations or proof of property impact.'
  ) value
  from latest_run lr full join latest_success ls on true cross join feature_health fh
)
select jsonb_set(base.value, '{nhc}', coalesce(nhc.value, jsonb_build_object(
  'source', 'nhc_gis', 'state', 'failed', 'active_cyclones_discovered', 0,
  'latest_advisories', '[]'::jsonb, 'received_product_types', '[]'::jsonb,
  'interpretation', 'No NHC ingestion run is available.')), true)
from base left join nhc on true;
$$;

revoke all on function public.mcp_search_tropical_cyclones(
  boolean,text,timestamptz,timestamptz,text[],text[],text,text,text,text,timestamptz,integer
) from public, anon, authenticated;
revoke all on function public.mcp_data_health_without_nhc() from public, anon, authenticated;
revoke all on function public.mcp_data_health() from public, anon, authenticated;
grant execute on function public.mcp_search_tropical_cyclones(
  boolean,text,timestamptz,timestamptz,text[],text[],text,text,text,text,timestamptz,integer
) to service_role;
grant execute on function public.mcp_data_health_without_nhc() to service_role;
grant execute on function public.mcp_data_health() to service_role;
