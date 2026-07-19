-- Versioned Census geography and reproducible event-to-territory derivation.
create table public.geographic_import_runs (
  id uuid primary key default gen_random_uuid(),
  vintage integer not null,
  area_type text not null check (area_type in ('state', 'county', 'place', 'zcta')),
  scope text not null,
  source_url text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'complete', 'failed')),
  records_received integer not null default 0 check (records_received >= 0),
  records_loaded integer not null default 0 check (records_loaded >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  error_message text,
  check (completed_at is null or completed_at >= started_at)
);

create table public.geographic_areas (
  id uuid primary key default gen_random_uuid(),
  vintage integer not null,
  area_type text not null check (area_type in ('state', 'county', 'place', 'zcta')),
  geoid text not null,
  name text,
  state_fips text,
  county_fips text,
  zcta5 text,
  geometry extensions.geometry(MultiPolygon, 4326) not null,
  source_url text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vintage, area_type, geoid),
  check (not extensions.st_isempty(geometry)),
  check (extensions.st_isvalid(geometry)),
  check (area_type <> 'zcta' or zcta5 ~ '^[0-9]{5}$')
);

create index geographic_areas_geometry_gix on public.geographic_areas using gist (geometry);
create index geographic_areas_lookup_idx on public.geographic_areas (vintage, area_type, geoid);
create index geographic_areas_state_county_idx on public.geographic_areas (state_fips, county_fips);
create index geographic_areas_zcta_idx on public.geographic_areas (zcta5) where zcta5 is not null;

create table public.storm_event_areas (
  storm_event_id uuid not null references public.storm_events(id) on delete cascade,
  geographic_area_id uuid not null references public.geographic_areas(id) on delete cascade,
  relation text not null check (relation in ('covers_centroid', 'intersects_geometry')),
  intersection_ratio numeric check (intersection_ratio is null or intersection_ratio between 0 and 1),
  derived_at timestamptz not null default now(),
  method_version text not null,
  primary key (storm_event_id, geographic_area_id, relation, method_version)
);

create index storm_event_areas_area_idx on public.storm_event_areas (geographic_area_id, storm_event_id);

create table public.storm_event_geospatial_status (
  storm_event_id uuid not null references public.storm_events(id) on delete cascade,
  vintage integer not null,
  status text not null check (status in ('complete', 'partial', 'insufficient_geometry', 'failed')),
  association_count integer not null default 0 check (association_count >= 0),
  method_version text not null,
  processed_at timestamptz not null default now(),
  error_message text,
  primary key (storm_event_id, vintage, method_version)
);

create or replace function public.enrich_storm_events(
  p_event_ids uuid[] default null,
  p_vintage integer default 2025,
  p_method_version text default 'census-postgis-v1'
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_selected integer;
begin
  select count(*) into v_selected
  from public.storm_events e
  where p_event_ids is null or e.id = any(p_event_ids);

  delete from public.storm_event_areas sea
  using public.geographic_areas ga
  where sea.geographic_area_id = ga.id
    and ga.vintage = p_vintage
    and sea.method_version = p_method_version
    and (p_event_ids is null or sea.storm_event_id = any(p_event_ids));

  insert into public.storm_event_areas (
    storm_event_id, geographic_area_id, relation, intersection_ratio, method_version
  )
  select e.id, ga.id, 'covers_centroid', null, p_method_version
  from public.storm_events e
  join public.geographic_areas ga
    on ga.vintage = p_vintage
   and e.centroid is not null
   and extensions.st_covers(ga.geometry, e.centroid)
  where (p_event_ids is null or e.id = any(p_event_ids))
    and (e.geometry is null or extensions.st_dimension(e.geometry) = 0)
  on conflict do nothing;

  insert into public.storm_event_areas (
    storm_event_id, geographic_area_id, relation, intersection_ratio, method_version
  )
  select e.id, ga.id, 'intersects_geometry',
    least(1::numeric, greatest(0::numeric,
      extensions.st_area(extensions.st_intersection(e.geometry, ga.geometry)::extensions.geography)
      / nullif(extensions.st_area(ga.geometry::extensions.geography), 0)
    )),
    p_method_version
  from public.storm_events e
  join public.geographic_areas ga
    on ga.vintage = p_vintage
   and e.geometry is not null
   and extensions.st_dimension(e.geometry) = 2
   and extensions.st_intersects(ga.geometry, e.geometry)
  where p_event_ids is null or e.id = any(p_event_ids)
  on conflict do nothing;

  insert into public.storm_event_geospatial_status (
    storm_event_id, vintage, status, association_count, method_version, processed_at
  )
  select e.id, p_vintage,
    case
      when e.centroid is null and e.geometry is null then 'insufficient_geometry'
      when count(ga.id) = 0 then 'partial'
      else 'complete'
    end,
    count(ga.id), p_method_version, now()
  from public.storm_events e
  left join public.storm_event_areas sea
    on sea.storm_event_id = e.id and sea.method_version = p_method_version
  left join public.geographic_areas ga
    on ga.id = sea.geographic_area_id and ga.vintage = p_vintage
  where p_event_ids is null or e.id = any(p_event_ids)
  group by e.id, e.centroid, e.geometry
  on conflict (storm_event_id, vintage, method_version) do update set
    status = excluded.status,
    association_count = excluded.association_count,
    processed_at = excluded.processed_at,
    error_message = null;

  return jsonb_build_object(
    'selected_events', v_selected,
    'associations', (select count(*) from public.storm_event_areas sea
      join public.geographic_areas ga on ga.id = sea.geographic_area_id
      where ga.vintage = p_vintage and sea.method_version = p_method_version
        and (p_event_ids is null or sea.storm_event_id = any(p_event_ids))),
    'vintage', p_vintage,
    'method_version', p_method_version
  );
end;
$$;

create or replace function public.mcp_get_event_geographies(p_event_id uuid, p_vintage integer default 2025)
returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'geospatial_status', coalesce(s.status, 'not_processed'),
  'vintage', p_vintage,
  'method_version', coalesce(s.method_version, 'census-postgis-v1'),
  'areas', coalesce(jsonb_agg(jsonb_build_object(
    'area_type', ga.area_type, 'geoid', ga.geoid, 'name', ga.name,
    'state_fips', ga.state_fips, 'county_fips', ga.county_fips, 'zcta5', ga.zcta5,
    'relation', sea.relation, 'intersection_ratio', sea.intersection_ratio
  ) order by ga.area_type, ga.geoid) filter (where ga.id is not null), '[]'::jsonb)
)
from public.storm_events e
left join public.storm_event_geospatial_status s
  on s.storm_event_id = e.id and s.vintage = p_vintage and s.method_version = 'census-postgis-v1'
left join public.storm_event_areas sea
  on sea.storm_event_id = e.id and sea.method_version = 'census-postgis-v1'
left join public.geographic_areas ga
  on ga.id = sea.geographic_area_id and ga.vintage = p_vintage
where e.id = p_event_id
group by s.status, s.method_version;
$$;

create trigger geographic_areas_set_updated_at
before update on public.geographic_areas
for each row execute function public.set_updated_at();

alter table public.geographic_import_runs enable row level security;
alter table public.geographic_areas enable row level security;
alter table public.storm_event_areas enable row level security;
alter table public.storm_event_geospatial_status enable row level security;

revoke all on table public.geographic_import_runs, public.geographic_areas,
  public.storm_event_areas, public.storm_event_geospatial_status from anon, authenticated;
revoke execute on function public.enrich_storm_events(uuid[],integer,text) from public, anon, authenticated;
revoke execute on function public.mcp_get_event_geographies(uuid,integer) from public, anon, authenticated;
grant execute on function public.enrich_storm_events(uuid[],integer,text) to service_role;
grant execute on function public.mcp_get_event_geographies(uuid,integer) to service_role;
