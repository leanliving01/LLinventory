-- 022_disable_rls_all_public.sql
-- Recurring symptom: a page (often on the floor app) hangs on "loading… / slow
-- connection" and never shows data. The usual cause is Row Level Security being ENABLED
-- on a table with no policy for the app's role, so every read silently returns nothing.
--
-- This project's security model is app-level, NOT RLS (see migrations 003 / 017, which
-- disable RLS table by table). Every time a NEW table is created it defaults to having
-- RLS available, and if it ever gets enabled the table goes dark app-wide. This migration
-- makes the policy explicit and permanent: RLS is DISABLED on every base table in the
-- public schema. Run it whenever data won't load, and after adding new tables.
--
-- Idempotent: safe to run multiple times.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY;', r.schemaname, r.tablename);
  END LOOP;
END $$;
