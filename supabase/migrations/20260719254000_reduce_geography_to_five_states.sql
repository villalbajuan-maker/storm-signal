-- Reduce Census/PostGIS reference geography to the approved commercial focus.
-- Retained: TX (48), FL (12), LA (22), GA (13), NC (37).
-- Removed: CO (08), KS (20), MO (29), MT (30), NE (31), OK (40), SC (45).
-- A ZCTA is retained whenever it intersects any retained state.
do $$
declare
  v_candidate_count integer;
  v_removed_state_count integer;
  v_retained_state_count integer;
  v_deleted_count integer;
begin
  lock table public.geographic_areas in share row exclusive mode;

  -- A clean schema replay has no Census seed data. The destructive reduction
  -- is only meaningful after the importer has populated geographic_areas.
  if not exists (select 1 from public.geographic_areas) then
    raise notice 'Geography reduction skipped: geographic_areas is empty';
    return;
  end if;

  create temporary table geography_reduction_candidates (
    id uuid primary key
  ) on commit drop;

  insert into geography_reduction_candidates (id)
  with retained_states as materialized (
    select geometry
    from public.geographic_areas
    where area_type = 'state'
      and state_fips in ('48', '12', '22', '13', '37')
  )
  select g.id
  from public.geographic_areas g
  where (
    g.area_type <> 'zcta'
    and g.state_fips in ('08', '20', '29', '30', '31', '40', '45')
  ) or (
    g.area_type = 'zcta'
    and not exists (
      select 1
      from retained_states s
      where extensions.st_intersects(g.geometry, s.geometry)
    )
  );

  select count(*) into v_candidate_count
  from geography_reduction_candidates;

  select count(*) into v_removed_state_count
  from public.geographic_areas g
  join geography_reduction_candidates c on c.id = g.id
  where g.area_type = 'state'
    and g.state_fips in ('08', '20', '29', '30', '31', '40', '45');

  select count(*) into v_retained_state_count
  from public.geographic_areas
  where area_type = 'state'
    and state_fips in ('48', '12', '22', '13', '37');

  if v_candidate_count <> 11485 then
    raise exception 'Geography reduction aborted: expected 11485 candidates, found %', v_candidate_count;
  end if;
  if v_removed_state_count <> 7 then
    raise exception 'Geography reduction aborted: expected all 7 removable states, found %', v_removed_state_count;
  end if;
  if v_retained_state_count <> 5 then
    raise exception 'Geography reduction aborted: expected all 5 retained states, found %', v_retained_state_count;
  end if;

  with deleted as (
    delete from public.geographic_areas g
    using geography_reduction_candidates c
    where g.id = c.id
    returning g.id
  )
  select count(*) into v_deleted_count from deleted;

  if v_deleted_count <> v_candidate_count then
    raise exception 'Geography reduction aborted: expected to delete %, deleted %',
      v_candidate_count, v_deleted_count;
  end if;

  if exists (
    select 1
    from public.geographic_areas
    where area_type <> 'zcta'
      and state_fips in ('08', '20', '29', '30', '31', '40', '45')
  ) then
    raise exception 'Geography reduction aborted: removable non-ZCTA geography remains';
  end if;

  raise notice 'Geography reduction deleted % areas; retained five-state focus', v_deleted_count;
end;
$$;
