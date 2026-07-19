-- Keep MCP coverage metadata aligned with the five-state geography footprint.
delete from public.geographic_coverage_summary
where vintage = 2025
  and method_version = 'census-postgis-v1'
  and state_fips not in ('48', '12', '22', '13', '37');

do $$
declare
  v_covered_states integer;
begin
  select count(*) into v_covered_states
  from public.geographic_coverage_summary
  where vintage = 2025
    and method_version = 'census-postgis-v1';

  if v_covered_states <> 5 then
    raise exception 'Coverage summary alignment aborted: expected 5 states, found %', v_covered_states;
  end if;
end;
$$;
