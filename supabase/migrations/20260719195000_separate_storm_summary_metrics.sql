-- Keep unlike physical units separate when multiple event types share a group.
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
  select group_key,
    count(*) event_count,
    count(*) filter (where event_type in ('hail_report', 'historical_hail_event')) hail_report_count,
    count(*) filter (where event_type = 'wind_report') wind_report_count,
    count(*) filter (where event_type = 'tornado_report') tornado_report_count,
    max(magnitude) filter (where event_type in ('hail_report', 'historical_hail_event') and magnitude_unit = 'inch') max_hail_inches,
    max(magnitude) filter (where event_type = 'wind_report' and magnitude_unit = 'mph') max_wind_mph,
    max(started_at) latest_event_at
  from filtered group by group_key
)
select coalesce(jsonb_agg(jsonb_build_object(
  'group', group_key,
  'event_count', event_count,
  'hail_report_count', hail_report_count,
  'wind_report_count', wind_report_count,
  'tornado_report_count', tornado_report_count,
  'max_hail_inches', max_hail_inches,
  'max_wind_mph', max_wind_mph,
  'latest_event_at', latest_event_at
) order by event_count desc, group_key), '[]'::jsonb) from grouped;
$$;

revoke execute on function public.mcp_summarize_storm_activity(timestamptz,timestamptz,text,text,text[]) from public, anon, authenticated;
grant execute on function public.mcp_summarize_storm_activity(timestamptz,timestamptz,text,text,text[]) to service_role;
