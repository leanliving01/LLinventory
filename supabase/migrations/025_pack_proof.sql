-- 025_pack_proof.sql
-- Proof-of-pack photos: when a packer finishes a section, they photograph the sealed,
-- labelled box. The (compressed ~100KB) image is uploaded to Supabase Storage and its URL
-- saved per section on the order + on the completed packing event.
-- Idempotent.

-- URL columns
ALTER TABLE sales_orders       ADD COLUMN IF NOT EXISTS sup_proof_url text;
ALTER TABLE sales_orders       ADD COLUMN IF NOT EXISTS mea_proof_url text;
ALTER TABLE packing_event_logs ADD COLUMN IF NOT EXISTS proof_url     text;

-- Public storage bucket for the proof photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('pack-proofs', 'pack-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- The floor app uploads with the anon/authenticated key, so allow inserts (and reads) on
-- this bucket. (Bucket is public so reads also work via the public URL.)
DROP POLICY IF EXISTS "pack-proofs insert" ON storage.objects;
CREATE POLICY "pack-proofs insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'pack-proofs');

DROP POLICY IF EXISTS "pack-proofs select" ON storage.objects;
CREATE POLICY "pack-proofs select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'pack-proofs');

-- ── 45-day retention (optional — run once; needs the pg_cron extension) ──
-- Enable pg_cron in Dashboard → Database → Extensions, then:
--   create extension if not exists pg_cron;
--   select cron.schedule('purge-pack-proofs','0 3 * * *',
--     $$ delete from storage.objects
--        where bucket_id='pack-proofs' and created_at < now() - interval '45 days' $$);
-- (Removes proof photos older than 45 days so storage stays a rolling window.)
