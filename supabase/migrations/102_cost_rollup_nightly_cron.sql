-- 102 — Nightly cost rollup.
--
-- The cost-rollup edge function cascades raw → bulk → meal → package cost. It runs
-- after every GRN and on the manual "Run Cost Rollup" button, but a raw cost can
-- change WITHOUT a receipt (an invoice-only price change, or accepting a fix in the
-- Price Variances queue) — in which case meals/packages wouldn't refresh until the
-- next GRN. This nightly job guarantees every meal + package cost reflects the
-- latest ingredient costs within 24h, however the raw cost changed.
--
-- The Authorization header reads the (public) anon key from Vault, so no token is
-- committed. Seed it once (outside git):
--   insert into vault.secrets (name, secret)
--   select 'cost_rollup_anon_key', '<ANON_KEY>'
--   where not exists (select 1 from vault.secrets where name = 'cost_rollup_anon_key');

create extension if not exists pg_net;

-- Re-run safe: drop any prior job of this name first.
do $$ begin perform cron.unschedule('cost-rollup-nightly'); exception when others then null; end $$;

select cron.schedule(
  'cost-rollup-nightly',
  '30 2 * * *',                              -- 02:30 daily (after the 02:00 inventory snapshot)
  $cmd$
  select net.http_post(
    url     := 'https://cpzkmzcohujpybcocipe.supabase.co/functions/v1/cost-rollup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cost_rollup_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $cmd$
);
