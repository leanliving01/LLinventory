-- 021_timestamp_guard_trigger.sql
-- Bulletproof fix for the recurring "null value in column created_date ... violates
-- not-null constraint" on shopify_orders (and any other synced table).
--
-- Why migration 020 (DEFAULT now()) was not enough:
-- The Shopify sync builds ONE upsert from a MIXED batch — new orders (which carry
-- created_date) plus existing orders (which omit it). supabase-js unions the keys
-- across the batch, so created_date ends up in the INSERT column list for *every*
-- row, and the existing-order rows are sent as an EXPLICIT NULL. A column DEFAULT
-- only applies when a column is omitted, NOT when NULL is passed explicitly — so the
-- NOT NULL constraint still fires. This happens on any sync page that contains both
-- new and already-synced orders (i.e. almost always).
--
-- A BEFORE-trigger runs on the actual row and can coalesce the explicit NULL away,
-- which a DEFAULT cannot. It also pins created_date to its original value on UPDATE,
-- so the same mixed upsert can't overwrite a real created_date with now() either.
--
-- Applied to every public table that has both created_date and updated_date.
-- Idempotent: safe to run multiple times.

CREATE OR REPLACE FUNCTION public.guard_row_timestamps()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.created_date IS NULL THEN NEW.created_date := now(); END IF;
    IF NEW.updated_date IS NULL THEN NEW.updated_date := now(); END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- created_date is immutable: never let an update (incl. ON CONFLICT DO UPDATE)
    -- change it. This neutralises the mixed-upsert NULL/clobber problem.
    NEW.created_date := OLD.created_date;
    IF NEW.updated_date IS NULL THEN NEW.updated_date := now(); END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c1.table_schema, c1.table_name
    FROM information_schema.columns c1
    JOIN information_schema.columns c2
      ON c2.table_schema = c1.table_schema
     AND c2.table_name   = c1.table_name
     AND c2.column_name  = 'updated_date'
    WHERE c1.table_schema = 'public'
      AND c1.column_name  = 'created_date'
    GROUP BY c1.table_schema, c1.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_timestamps ON %I.%I;', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_guard_timestamps BEFORE INSERT OR UPDATE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.guard_row_timestamps();',
      r.table_schema, r.table_name
    );
    RAISE NOTICE 'Attached timestamp guard trigger to %.%', r.table_schema, r.table_name;
  END LOOP;
END $$;
