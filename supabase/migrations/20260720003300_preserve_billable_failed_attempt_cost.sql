begin;

create or replace function public.finalize_execution_for_user(
  p_user_id uuid,
  p_run_id uuid,
  p_status text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_mcp_calls integer default 0,
  p_estimated_cost_cents integer default 0,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'failed', 'canceled') then
    raise exception 'Invalid terminal status' using errcode = '22023';
  end if;
  update public.execution_runs
  set status = p_status,
      input_tokens = greatest(0, p_input_tokens),
      output_tokens = greatest(0, p_output_tokens),
      mcp_calls = greatest(0, p_mcp_calls),
      estimated_cost_cents = greatest(0, p_estimated_cost_cents),
      error_code = left(p_error_code, 100),
      completed_at = now()
  where id = p_run_id and user_id = p_user_id and status in ('reserved', 'running');
  return found;
end;
$$;

revoke all on function public.finalize_execution_for_user(
  uuid, uuid, text, integer, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.finalize_execution_for_user(
  uuid, uuid, text, integer, integer, integer, integer, text
) to service_role;

comment on function public.finalize_execution_for_user(
  uuid, uuid, text, integer, integer, integer, integer, text
) is 'Finalizes execution outcome while retaining measured billable cost from failed, canceled, quality-rejected or fallback attempts.';

commit;
