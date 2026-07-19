-- NHC active-cyclone discovery and GIS ingestion every five minutes.
select cron.schedule(
  'storm-signal-nhc-every-5-minutes',
  '1-59/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_project_url') || '/functions/v1/storm_signal_nhc_ingestor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storm-signal-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'storm_signal_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
