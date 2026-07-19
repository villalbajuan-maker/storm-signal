-- Backend-only, PostGIS-aware read API used by the Storm Signal MCP.
create or replace function public.mcp_search_storm_events(
    p_start_at timestamptz default null,
    p_end_at timestamptz default null,
    p_event_types text[] default null,
    p_state text default null,
    p_county text default null,
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
    and (p_county is null or upper(e.county) = upper(p_county))
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
  'distance_miles', case when distance_miles is null then null else round(distance_miles::numeric, 2) end
) order by started_at desc), '[]'::jsonb) from matches;
$$;

create or replace function public.mcp_get_storm_event(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'event', jsonb_build_object(
    'id', e.id, 'event_type', e.event_type, 'status', e.status,
    'started_at', e.started_at, 'ended_at', e.ended_at,
    'magnitude', e.magnitude, 'magnitude_unit', e.magnitude_unit,
    'severity', e.severity, 'urgency', e.urgency, 'certainty', e.certainty,
    'state', e.state, 'county', e.county, 'source', e.source,
    'source_record_id', e.source_record_id, 'source_url', e.source_url,
    'geometry', case when e.geometry is null then null else extensions.st_asgeojson(e.geometry)::jsonb end,
    'centroid', case when e.centroid is null then null else extensions.st_asgeojson(e.centroid)::jsonb end
  ),
  'source_versions', coalesce((select jsonb_agg(jsonb_build_object(
    'retrieved_at', r.retrieved_at, 'payload_hash', r.payload_hash,
    'source_url', r.source_url, 'payload', r.payload_json
  ) order by r.retrieved_at desc) from public.source_records r
  where r.source = e.source and r.source_record_id = e.source_record_id), '[]'::jsonb)
) from public.storm_events e where e.id = p_event_id;
$$;

create or replace function public.mcp_summarize_storm_activity(
  p_start_at timestamptz, p_end_at timestamptz,
  p_group_by text default 'event_type', p_state text default null,
  p_event_types text[] default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with filtered as (
  select *, case p_group_by
    when 'state' then coalesce(state, 'unknown')
    when 'county' then coalesce(county, 'unknown')
    when 'day' then to_char(started_at at time zone 'UTC', 'YYYY-MM-DD')
    else event_type end as group_key
  from public.storm_events
  where started_at >= p_start_at and started_at <= p_end_at
    and (p_state is null or upper(state) = upper(p_state))
    and (p_event_types is null or event_type = any(p_event_types))
), grouped as (
  select group_key, count(*) event_count, max(magnitude) max_hail_inches,
    max(started_at) latest_event_at from filtered group by group_key
)
select coalesce(jsonb_agg(jsonb_build_object(
  'group', group_key, 'event_count', event_count,
  'max_hail_inches', max_hail_inches, 'latest_event_at', latest_event_at
) order by event_count desc, group_key), '[]'::jsonb) from grouped;
$$;

revoke execute on function public.mcp_search_storm_events(timestamptz,timestamptz,text[],text,text,numeric,text,double precision,double precision,double precision,integer) from public, anon, authenticated;
revoke execute on function public.mcp_get_storm_event(uuid) from public, anon, authenticated;
revoke execute on function public.mcp_summarize_storm_activity(timestamptz,timestamptz,text,text,text[]) from public, anon, authenticated;
grant execute on function public.mcp_search_storm_events(timestamptz,timestamptz,text[],text,text,numeric,text,double precision,double precision,double precision,integer) to service_role;
grant execute on function public.mcp_get_storm_event(uuid) to service_role;
grant execute on function public.mcp_summarize_storm_activity(timestamptz,timestamptz,text,text,text[]) to service_role;
