-- ============================================================================
-- 091_production_task_sequence
-- Production SEQUENCING: the engine computes a smart cook→prep→portion ORDER
-- (broad + slow components first so portioning starts early and stays fed), and
-- writes a per-task `sequence_order` onto production_tasks. The floor tablets and
-- the Kanban board then render each station's work IN THAT ORDER instead of by
-- raw recipe step_no.
--
-- Additive + safe: default 0, so existing/old runs (sequence_order = 0) keep
-- their step_no ordering via the client-side tiebreak.
--
-- ⚠️  Applied via the Supabase Management API with this file as the record.
-- ============================================================================

ALTER TABLE production_tasks
  ADD COLUMN IF NOT EXISTS sequence_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_production_tasks_sequence
  ON production_tasks (run_id, station, sequence_order);
