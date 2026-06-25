-- 075_cost_timestamps.sql
-- Adds "last updated" timestamps to the two product cost fields so the UI can
-- show WHEN each cost was last refreshed (and prove it reflects the latest price).
--
-- Also backfills the legacy zeros: historically `cost_current` was only ever
-- written by GRN confirmation, so the ~345 products whose stock/cost came from
-- the CIN7 import (or from BOM roll-ups) show a correct weighted-average cost
-- but a zero "current cost". This backfill gives every costed product a real
-- current cost + date immediately. `cost_current` is display-only (every
-- valuation uses cost_avg first), so this cannot distort any valuation.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_avg_updated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS cost_current_updated_at timestamptz;

-- 1. cost_current + its date from each product's most recent COSTED receipt
--    (real last purchase price — e.g. Beef Mince -> 124.48 on its import date).
WITH last_rec AS (
  SELECT DISTINCT ON (product_id)
         product_id,
         unit_cost_at_movement AS cost,
         created_date          AS d
  FROM stock_movements
  WHERE reason = 'receipt' AND unit_cost_at_movement > 0
  ORDER BY product_id, created_date DESC
)
UPDATE products p
SET cost_current            = lr.cost,
    cost_current_updated_at = lr.d
FROM last_rec lr
WHERE p.id = lr.product_id
  AND COALESCE(p.cost_current, 0) = 0;

-- 2. cost_avg date: latest receipt date if the product was ever received,
--    otherwise fall back to the product's own updated_date (roll-up timestamp).
WITH last_any_rec AS (
  SELECT product_id, MAX(created_date) AS d
  FROM stock_movements
  WHERE reason = 'receipt'
  GROUP BY product_id
)
UPDATE products p
SET cost_avg_updated_at = COALESCE(lar.d, p.updated_date)
FROM last_any_rec lar
WHERE p.id = lar.product_id
  AND p.cost_avg_updated_at IS NULL
  AND COALESCE(p.cost_avg, 0) > 0;

UPDATE products
SET cost_avg_updated_at = updated_date
WHERE cost_avg_updated_at IS NULL
  AND COALESCE(cost_avg, 0) > 0;

-- 3. Manufactured / never-received items (finished meals, bulk WIP, packs):
--    mirror the rolled weighted-average into current cost so they stop showing 0.
--    Going forward the cost-rollup function keeps both in sync.
UPDATE products
SET cost_current            = cost_avg,
    cost_current_updated_at = COALESCE(cost_avg_updated_at, updated_date)
WHERE COALESCE(cost_current, 0) = 0
  AND COALESCE(cost_avg, 0) > 0;
