create or replace function public.enrich_storm_events_for_state(
  p_state text,
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
begin
  if nullif(btrim(p_state), '') is null then
    raise exception 'p_state is required';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_event_ids
  from public.storm_events
  where upper(state) = upper(btrim(p_state));

  return public.enrich_storm_events(v_event_ids, p_vintage, p_method_version);
end;
$$;

revoke all on function public.enrich_storm_events_for_state(text, integer, text) from public;
grant execute on function public.enrich_storm_events_for_state(text, integer, text) to service_role;
