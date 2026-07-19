drop function if exists public.mcp_search_storm_events(
  timestamptz,timestamptz,text[],text,text,numeric,text,
  double precision,double precision,double precision,integer
);

create function public.mcp_search_storm_events(
    p_start_at timestamptz default null,
    p_end_at timestamptz default null,
    p_event_types text[] default null,
    p_state text default null,
    p_county text default null,
    p_place text default null,
    p_zcta text default null,
    p_min_hail_inches numeric default null,
    p_status text default null,
    p_lat double precision default null,
    p_lon double precision default null,
    p_radius_miles double precision default null,
    p_limit integer default 50
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with origin as (
  select case when p_lat is not null and p_lon is not null
    then extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geometry
  end as point
), matches as (
  select e.*,
    case when o.point is not null and e.centroid is not null then
      extensions.st_distance(e.centroid::extensions.geography, o.point::extensions.geography) / 1609.344
    end as distance_miles
  from public.storm_events e cross join origin o
  where (p_start_at is null or e.started_at >= p_start_at)
    and (p_end_at is null or e.started_at <= p_end_at)
    and (p_event_types is null or e.event_type = any(p_event_types))
    and (p_state is null or upper(e.state) = upper(p_state))
    and (p_county is null
      or upper(coalesce(e.county, '')) = upper(p_county)
      or exists (
        select 1 from public.storm_event_areas sea
        join public.geographic_areas ga on ga.id = sea.geographic_area_id
        where sea.storm_event_id = e.id and sea.method_version = 'census-postgis-v1'
          and ga.vintage = 2025 and ga.area_type = 'county'
          and upper(regexp_replace(ga.name, '\s+(County|Parish)$', '', 'i')) =
              upper(regexp_replace(p_county, '\s+(County|Parish)$', '', 'i'))
      ))
    and (p_place is null or exists (
      select 1 from public.storm_event_areas sea
      join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = e.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'place' and upper(ga.name) = upper(p_place)
    ))
    and (p_zcta is null or exists (
      select 1 from public.storm_event_areas sea
      join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = e.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'zcta' and ga.zcta5 = btrim(p_zcta)
    ))
    and (p_min_hail_inches is null or e.magnitude >= p_min_hail_inches)
    and (p_status is null or lower(e.status) = lower(p_status))
    and (o.point is null or (e.centroid is not null and extensions.st_dwithin(
      e.centroid::extensions.geography, o.point::extensions.geography, p_radius_miles * 1609.344)))
  order by e.started_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', id, 'event_type', event_type, 'status', status,
  'started_at', started_at, 'ended_at', ended_at,
  'magnitude', magnitude, 'magnitude_unit', magnitude_unit,
  'severity', severity, 'urgency', urgency, 'certainty', certainty,
  'state', state, 'county', county, 'source', source,
  'source_record_id', source_record_id, 'source_url', source_url,
  'geometry', case when geometry is null then null else extensions.st_asgeojson(geometry)::jsonb end,
  'centroid', case when centroid is null then null else extensions.st_asgeojson(centroid)::jsonb end,
  'distance_miles', case when distance_miles is null then null else round(distance_miles::numeric, 2) end,
  'geography', jsonb_build_object(
    'states', (select coalesce(jsonb_agg(distinct ga.name), '[]'::jsonb)
      from public.storm_event_areas sea join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = matches.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'state'),
    'counties', (select coalesce(jsonb_agg(distinct ga.name), '[]'::jsonb)
      from public.storm_event_areas sea join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = matches.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'county'),
    'places', (select coalesce(jsonb_agg(distinct ga.name), '[]'::jsonb)
      from public.storm_event_areas sea join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = matches.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'place'),
    'zctas', (select coalesce(jsonb_agg(distinct ga.zcta5), '[]'::jsonb)
      from public.storm_event_areas sea join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where sea.storm_event_id = matches.id and sea.method_version = 'census-postgis-v1'
        and ga.vintage = 2025 and ga.area_type = 'zcta'),
    'vintage', 2025,
    'method_version', 'census-postgis-v1',
    'zcta_interpretation', 'ZCTA is an approximate ZIP area from Census geography, not a USPS delivery boundary.'
  )
) order by started_at desc), '[]'::jsonb) from matches;
$$;

revoke execute on function public.mcp_search_storm_events(
  timestamptz,timestamptz,text[],text,text,text,text,numeric,text,
  double precision,double precision,double precision,integer
) from public, anon, authenticated;
grant execute on function public.mcp_search_storm_events(
  timestamptz,timestamptz,text[],text,text,text,text,numeric,text,
  double precision,double precision,double precision,integer
) to service_role;
