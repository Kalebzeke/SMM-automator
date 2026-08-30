-- 0005_telegram_worker_cron.sql
-- Schedules the Telegram delivery worker every minute via pg_cron + pg_net.
-- Requires the same Vault secrets as 0003_supabase_sync_cron.sql:
--   app_url      -> e.g. https://your-app.vercel.app
--   cron_secret  -> same value as CRON_SECRET in Vercel env

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'telegram-worker-every-minute';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'telegram-worker-every-minute',
  '* * * * *',
  $$
  select
    net.http_get(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'app_url'
      ) || '/api/cron/telegram-worker?secret=' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    );
  $$
);
