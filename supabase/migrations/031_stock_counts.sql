-- 031_stock_counts.sql
-- Build 1 of the reviewed stock-count workflow. Extends the existing (currently
-- unused) new_stock_takes + stock_take_lines tables instead of creating a
-- duplicate module. Floor counts no longer post directly to stock-on-hand;
-- they are reviewed and posted from the web.
--
-- Idempotent — safe to run more than once.

-- ---------------------------------------------------------------------------
-- Header: new_stock_takes
-- ---------------------------------------------------------------------------
ALTER TABLE new_stock_takes
  ADD COLUMN IF NOT EXISTS reference          text,
  ADD COLUMN IF NOT EXISTS count_type         text NOT NULL DEFAULT 'planned',  -- planned | live
  ADD COLUMN IF NOT EXISTS assigned_to        text,
  ADD COLUMN IF NOT EXISTS assigned_to_name   text,
  ADD COLUMN IF NOT EXISTS item_group         text,
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS submitted_by       text,
  ADD COLUMN IF NOT EXISTS submitted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by        text,
  ADD COLUMN IF NOT EXISTS reviewed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by          text,
  ADD COLUMN IF NOT EXISTS posted_at          timestamptz;

-- Widen the status lifecycle (set the full set now so later builds need no
-- further migration). Drop the old CHECK first, then re-add.
ALTER TABLE new_stock_takes DROP CONSTRAINT IF EXISTS new_stock_takes_status_check;
ALTER TABLE new_stock_takes
  ADD CONSTRAINT new_stock_takes_status_check CHECK (status IN (
    'draft','open','in_progress','floor_completed','under_review',
    'recount_requested','recount_in_progress','completed','cancelled'
  ));

-- ---------------------------------------------------------------------------
-- Lines: stock_take_lines
-- ---------------------------------------------------------------------------
ALTER TABLE stock_take_lines
  ADD COLUMN IF NOT EXISTS stock_uom           text,
  ADD COLUMN IF NOT EXISTS count_uom           text,
  ADD COLUMN IF NOT EXISTS count_uom_label     text,
  ADD COLUMN IF NOT EXISTS conversion_factor   numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS converted_qty       numeric,
  ADD COLUMN IF NOT EXISTS unit_cost           numeric,
  ADD COLUMN IF NOT EXISTS counted             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS count_attempt       integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_counted_qty numeric,
  ADD COLUMN IF NOT EXISTS recount_requested   boolean NOT NULL DEFAULT false;

-- counted_qty was NOT NULL; a line now exists before it is counted.
ALTER TABLE stock_take_lines ALTER COLUMN counted_qty DROP NOT NULL;
