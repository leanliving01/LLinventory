-- 020_default_timestamps.sql
-- Durable fix for the recurring "null value in column created_date ... violates
-- not-null constraint" errors (most often seen on shopify_orders during sync).
--
-- Root cause: created_date / updated_date are NOT NULL but several writer paths
-- (edge functions, the webhook handler, the client-side bulkUpdate upsert) rely on
-- application code to set them. Whenever any one path forgets — or a deployed edge
-- function lags behind the source that adds the column — the insert fails.
--
-- The fix is to give every created_date / updated_date column a DEFAULT now() at the
-- database level, so an omitted timestamp is filled automatically and no writer can
-- ever trip the NOT NULL constraint again. (A DEFAULT only applies when the column is
-- omitted; rows that explicitly set the value are unaffected, so existing timestamps
-- are never clobbered.)
--
-- Idempotent: safe to run multiple times.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('created_date', 'updated_date')
      AND (column_default IS NULL OR column_default NOT ILIKE '%now()%')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT now();',
      r.table_schema, r.table_name, r.column_name
    );
    RAISE NOTICE 'Set DEFAULT now() on %.%.%', r.table_schema, r.table_name, r.column_name;
  END LOOP;
END $$;
