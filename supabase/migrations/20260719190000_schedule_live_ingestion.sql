-- Reliable database-native scheduling for fast-changing live sources.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'storm_signal_project_url') then
    perform vault.create_secret('https://efzezjfvhkywxukluowh.supabase.co', 'storm_signal_project_url', 'Storm Signal Edge Function origin');
  end if;
end $$;

select cron.schedule(
  'storm-signal-nws-every-5-minutes',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_project_url') || '/functions/v1/storm_signal_ingestor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storm-signal-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_cron_secret')
    ),
    body := '{"source":"nws"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'storm-signal-spc-every-10-minutes',
  '3,13,23,33,43,53 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_project_url') || '/functions/v1/storm_signal_ingestor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storm-signal-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_cron_secret')
    ),
    body := '{"source":"spc"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
