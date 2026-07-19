-- Rolling operational retention. Census/PostGIS reference geography is intentionally excluded.
create or replace function public.prune_storm_signal_data(
  p_retention_days integer default 14,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cutoff timestamptz;
  v_events integer;
  v_advisories integer;
  v_features integer;
  v_raw integer := 0;
  v_runs integer := 0;
  v_cyclones integer := 0;
begin
  if p_retention_days < 7 or p_retention_days > 90 then
    raise exception 'retention days must be between 7 and 90';
  end if;
  v_cutoff := now() - make_interval(days => p_retention_days);

  select count(*) into v_events from public.storm_events
    where coalesce(ended_at, started_at) < v_cutoff;
  select count(*), coalesce(sum(feature_count), 0) into v_advisories, v_features
  from (
    select a.id, count(f.id) feature_count
    from public.cyclone_advisories a
    join public.tropical_cyclones c on c.id = a.cyclone_id
    left join public.cyclone_features f on f.advisory_id = a.id
    where not c.active and a.issued_at < v_cutoff
    group by a.id
  ) old_advisories;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true, 'retention_days', p_retention_days, 'cutoff', v_cutoff,
      'storm_events', v_events, 'cyclone_advisories', v_advisories,
      'cyclone_features', v_features,
      'excluded', 'geographic_areas and active cyclone advisories are never pruned'
    );
  end if;

  delete from public.storm_events
    where coalesce(ended_at, started_at) < v_cutoff;

  delete from public.cyclone_advisories a
  using public.tropical_cyclones c
    where a.cyclone_id = c.id and not c.active and a.issued_at < v_cutoff;

  with deleted as (
    delete from public.tropical_cyclones c
    where not c.active and not exists (
      select 1 from public.cyclone_advisories a where a.cyclone_id = c.id
    ) returning 1
  ) select count(*) into v_cyclones from deleted;

  with deleted as (
    delete from public.source_records sr
    where not exists (select 1 from public.storm_events e where e.raw_record_id = sr.id)
      and not exists (select 1 from public.cyclone_advisories a where a.source_record_id = sr.id)
      and not exists (select 1 from public.cyclone_features f where f.source_record_id = sr.id)
      and (
        (sr.source <> 'nhc_gis' and not exists (
          select 1 from public.storm_events e
          where e.source = sr.source and e.source_record_id = sr.source_record_id
        ))
        or (sr.source = 'nhc_gis' and not exists (
          select 1 from public.tropical_cyclones c
          where sr.source_record_id like c.atcf_id || ':%'
        ))
      )
    returning 1
  ) select count(*) into v_raw from deleted;

  with deleted as (
    delete from public.ingestion_runs where started_at < v_cutoff returning 1
  ) select count(*) into v_runs from deleted;

  return jsonb_build_object(
    'dry_run', false, 'retention_days', p_retention_days, 'cutoff', v_cutoff,
    'storm_events_deleted', v_events, 'cyclone_advisories_deleted', v_advisories,
    'cyclone_features_deleted', v_features, 'cyclones_deleted', v_cyclones,
    'source_records_deleted', v_raw, 'ingestion_runs_deleted', v_runs,
    'excluded', 'geographic_areas and active cyclone advisories were not pruned'
  );
end;
$$;

comment on function public.prune_storm_signal_data(integer, boolean) is
  'Deletes operational weather evidence outside a bounded rolling window; never deletes Census/PostGIS reference geography or active cyclone advisories.';

revoke all on function public.prune_storm_signal_data(integer, boolean) from public, anon, authenticated;
grant execute on function public.prune_storm_signal_data(integer, boolean) to service_role;

select cron.schedule(
  'storm-signal-retention-daily',
  '17 4 * * *',
  $$select public.prune_storm_signal_data(14, false);$$
);
