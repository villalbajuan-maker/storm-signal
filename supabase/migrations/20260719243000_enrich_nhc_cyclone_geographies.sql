-- Idempotent Census/PostGIS enrichment for versioned NHC cyclone features.

create or replace function public.enrich_cyclone_features(
  p_feature_ids uuid[] default null,
  p_vintage integer default 2025,
  p_method_version text default 'census-postgis-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_selected integer;
begin
  select count(*) into v_selected
  from public.cyclone_features f
  where p_feature_ids is null or f.id = any(p_feature_ids);

  delete from public.cyclone_feature_areas cfa
  using public.geographic_areas ga
  where cfa.geographic_area_id = ga.id
    and ga.vintage = p_vintage
    and cfa.method_version = p_method_version
    and (p_feature_ids is null or cfa.cyclone_feature_id = any(p_feature_ids));

  insert into public.cyclone_feature_areas (
    cyclone_feature_id,
    geographic_area_id,
    relation,
    intersection_ratio,
    method_version
  )
  select
    f.id,
    ga.id,
    'intersects_geometry',
    case
      when extensions.st_dimension(f.geometry) = 2 then
        least(1::numeric, greatest(0::numeric,
          extensions.st_area(
            extensions.st_collectionextract(
              extensions.st_makevalid(extensions.st_intersection(f.geometry, ga.geometry)),
              3
            )::extensions.geography
          ) / nullif(extensions.st_area(ga.geometry::extensions.geography), 0)
        ))
      else null
    end,
    p_method_version
  from public.cyclone_features f
  join public.geographic_areas ga
    on ga.vintage = p_vintage
   and extensions.st_intersects(ga.geometry, f.geometry)
  where p_feature_ids is null or f.id = any(p_feature_ids)
  on conflict do nothing;

  update public.cyclone_features f
  set geographic_status = case
      -- No state association means the feature was processed but lies offshore or
      -- outside the currently loaded Census state sequence. Coverage metadata must
      -- accompany this result; it is not proof that no territory exists.
      when not exists (
        select 1
        from public.cyclone_feature_areas cfa
        join public.geographic_areas ga on ga.id = cfa.geographic_area_id
        where cfa.cyclone_feature_id = f.id
          and cfa.method_version = p_method_version
          and ga.vintage = p_vintage
          and ga.area_type = 'state'
      ) then 'complete'
      when exists (
        select 1
        from public.cyclone_feature_areas cfa
        join public.geographic_areas ga on ga.id = cfa.geographic_area_id
        where cfa.cyclone_feature_id = f.id
          and cfa.method_version = p_method_version
          and ga.vintage = p_vintage
          and ga.area_type = 'county'
      ) and exists (
        select 1
        from public.cyclone_feature_areas cfa
        join public.geographic_areas ga on ga.id = cfa.geographic_area_id
        where cfa.cyclone_feature_id = f.id
          and cfa.method_version = p_method_version
          and ga.vintage = p_vintage
          and ga.area_type = 'zcta'
      ) then 'complete'
      else 'partial'
    end,
    geographic_processed_at = now(),
    geographic_error_message = null
  where p_feature_ids is null or f.id = any(p_feature_ids);

  return jsonb_build_object(
    'selected_features', v_selected,
    'associations', (
      select count(*)
      from public.cyclone_feature_areas cfa
      join public.geographic_areas ga on ga.id = cfa.geographic_area_id
      where ga.vintage = p_vintage
        and cfa.method_version = p_method_version
        and (p_feature_ids is null or cfa.cyclone_feature_id = any(p_feature_ids))
    ),
    'complete', (
      select count(*) from public.cyclone_features f
      where (p_feature_ids is null or f.id = any(p_feature_ids))
        and f.geographic_status = 'complete'
    ),
    'partial', (
      select count(*) from public.cyclone_features f
      where (p_feature_ids is null or f.id = any(p_feature_ids))
        and f.geographic_status = 'partial'
    ),
    'without_covered_state', (
      select count(*)
      from public.cyclone_features f
      where (p_feature_ids is null or f.id = any(p_feature_ids))
        and not exists (
          select 1
          from public.cyclone_feature_areas cfa
          join public.geographic_areas ga on ga.id = cfa.geographic_area_id
          where cfa.cyclone_feature_id = f.id
            and cfa.method_version = p_method_version
            and ga.vintage = p_vintage
            and ga.area_type = 'state'
        )
    ),
    'vintage', p_vintage,
    'method_version', p_method_version,
    'coverage_interpretation', 'No covered-state association means outside the loaded 12-state Census sequence or offshore; it is not proof that no territory exists.'
  );
end;
$$;

comment on function public.enrich_cyclone_features(uuid[], integer, text) is
  'Idempotently intersects NHC geometries with loaded Census areas; overlap does not imply forecast probability, impact, or damage.';

revoke all on function public.enrich_cyclone_features(uuid[], integer, text) from public, anon, authenticated;
grant execute on function public.enrich_cyclone_features(uuid[], integer, text) to service_role;
