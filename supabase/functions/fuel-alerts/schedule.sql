-- Register the fuel-alerts Edge Function as a pg_cron job.
-- Run this once in the Supabase SQL editor after deploying the function.
-- Requires pg_cron extension (enabled by default in Supabase).
--
-- The function is invoked via HTTP; Supabase Edge Function URLs follow:
--   https://<project-ref>.supabase.co/functions/v1/fuel-alerts
-- Replace <project-ref> below with your actual Supabase project reference.

SELECT cron.schedule(
  'fuel-alerts-hourly',
  '0 * * * *',   -- every hour on the hour
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/fuel-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To view scheduled jobs:
--   SELECT * FROM cron.job;
--
-- To unschedule:
--   SELECT cron.unschedule('fuel-alerts-hourly');
