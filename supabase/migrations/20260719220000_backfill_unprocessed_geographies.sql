create or replace function public.backfill_unprocessed_storm_event_geographies(
  p_vintage integer default 2025,
  p_method_version text default 'census-postgis-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event_ids uuid[];
  v_enrichment jsonb;
begin
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[])
    into v_event_ids
  from public.storm_events e
  where not exists (
    select 1
    from public.storm_event_geospatial_status s
    where s.storm_event_id = e.id
      and s.vintage = p_vintage
      and s.method_version = p_method_version
  );

  v_enrichment := public.enrich_storm_events(v_event_ids, p_vintage, p_method_version);

  update public.storm_event_geospatial_status s
  set status = case
      when e.centroid is null and e.geometry is null then 'insufficient_geometry'
      when not (
        exists (
          select 1 from public.storm_event_areas sea
          join public.geographic_areas ga on ga.id = sea.geographic_area_id
          where sea.storm_event_id = e.id and sea.method_version = p_method_version
            and ga.vintage = p_vintage and ga.area_type = 'state'
        )
        and exists (
          select 1 from public.storm_event_areas sea
          join public.geographic_areas ga on ga.id = sea.geographic_area_id
          where sea.storm_event_id = e.id and sea.method_version = p_method_version
            and ga.vintage = p_vintage and ga.area_type = 'county'
        )
        and exists (
          select 1 from public.storm_event_areas sea
          join public.geographic_areas ga on ga.id = sea.geographic_area_id
          where sea.storm_event_id = e.id and sea.method_version = p_method_version
            and ga.vintage = p_vintage and ga.area_type = 'zcta'
        )
      ) then 'partial'
      else 'complete'
    end,
    processed_at = now(),
    error_message = null
  from public.storm_events e
  where s.storm_event_id = e.id
    and s.vintage = p_vintage
    and s.method_version = p_method_version
    and e.id = any(v_event_ids);

  return jsonb_build_object(
    'selected_events', cardinality(v_event_ids),
    'associations', coalesce((v_enrichment ->> 'associations')::integer, 0),
    'complete', (select count(*) from public.storm_event_geospatial_status s
      where s.storm_event_id = any(v_event_ids) and s.vintage = p_vintage
        and s.method_version = p_method_version and s.status = 'complete'),
    'partial', (select count(*) from public.storm_event_geospatial_status s
      where s.storm_event_id = any(v_event_ids) and s.vintage = p_vintage
        and s.method_version = p_method_version and s.status = 'partial'),
    'insufficient_geometry', (select count(*) from public.storm_event_geospatial_status s
      where s.storm_event_id = any(v_event_ids) and s.vintage = p_vintage
        and s.method_version = p_method_version and s.status = 'insufficient_geometry'),
    'vintage', p_vintage,
    'method_version', p_method_version
  );
end;
$$;

revoke all on function public.backfill_unprocessed_storm_event_geographies(integer, text) from public;
grant execute on function public.backfill_unprocessed_storm_event_geographies(integer, text) to service_role;

select public.backfill_unprocessed_storm_event_geographies(2025, 'census-postgis-v1');
