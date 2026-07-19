-- Keep NHC MCP responses conversationally usable. Large cones and wind fields
-- can intersect thousands of Census areas; retain exact totals and a bounded,
-- deterministic sample for each geography type.

create or replace function public.mcp_search_tropical_cyclones_compact(
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
with raw as (
  select public.mcp_search_tropical_cyclones(
    p_active_only, p_atcf_id, p_issued_after, p_issued_before,
    p_product_types, p_evidence_classes, p_state, p_county, p_place,
    p_zcta, p_valid_at, p_limit
  ) value
), items as (
  select item, ordinality
  from raw, jsonb_array_elements(raw.value) with ordinality as x(item, ordinality)
), compact as (
  select ordinality, (item - 'geographies') || jsonb_build_object(
    'geography', jsonb_build_object(
      'total_area_count', jsonb_array_length(item->'geographies'),
      'area_counts', jsonb_build_object(
        'states', (select count(*) from jsonb_array_elements(item->'geographies') a where a->>'area_type' = 'state'),
        'counties', (select count(*) from jsonb_array_elements(item->'geographies') a where a->>'area_type' = 'county'),
        'places', (select count(*) from jsonb_array_elements(item->'geographies') a where a->>'area_type' = 'place'),
        'zctas', (select count(*) from jsonb_array_elements(item->'geographies') a where a->>'area_type' = 'zcta')
      ),
      'areas',
        coalesce((select jsonb_agg(a order by a->>'name') from (
          select a from jsonb_array_elements(item->'geographies') a
          where a->>'area_type' = 'state' order by a->>'name' limit 10
        ) s), '[]'::jsonb)
        || coalesce((select jsonb_agg(a order by a->>'name') from (
          select a from jsonb_array_elements(item->'geographies') a
          where a->>'area_type' = 'county' order by a->>'name' limit 10
        ) c), '[]'::jsonb)
        || coalesce((select jsonb_agg(a order by a->>'name') from (
          select a from jsonb_array_elements(item->'geographies') a
          where a->>'area_type' = 'place' order by a->>'name' limit 10
        ) p), '[]'::jsonb)
        || coalesce((select jsonb_agg(a order by a->>'name') from (
          select a from jsonb_array_elements(item->'geographies') a
          where a->>'area_type' = 'zcta' order by a->>'name' limit 10
        ) z), '[]'::jsonb),
      'areas_truncated', jsonb_array_length(item->'geographies') > 40,
      'sample_limit_per_type', 10,
      'method_version', 'census-postgis-v1',
      'zcta_interpretation', 'ZCTA is an approximate ZIP area from Census geography, not a USPS delivery boundary.'
    )
  ) item
  from items
)
select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) from compact;
$$;

revoke all on function public.mcp_search_tropical_cyclones_compact(
  boolean,text,timestamptz,timestamptz,text[],text[],text,text,text,text,timestamptz,integer
) from public, anon, authenticated;
grant execute on function public.mcp_search_tropical_cyclones_compact(
  boolean,text,timestamptz,timestamptz,text[],text[],text,text,text,text,timestamptz,integer
) to service_role;
