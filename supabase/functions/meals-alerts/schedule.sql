-- Register the meals-alerts Edge Function as an hourly pg_cron job.
-- Requires pg_cron and pg_net extensions (enable them in the Supabase
-- Dashboard -> Database -> Extensions before running this).

SELECT cron.schedule(
  'meals-alerts-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/meals-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To view: SELECT * FROM cron.job;
-- To remove: SELECT cron.unschedule('meals-alerts-hourly');
