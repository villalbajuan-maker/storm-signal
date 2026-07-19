-- Retention remains paused while the five-state geography reduction is reviewed.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'storm-signal-retention-daily';

  if v_job_id is not null then
    perform cron.alter_job(v_job_id, active := false);
  end if;
end;
$$;
