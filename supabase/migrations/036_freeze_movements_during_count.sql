-- 036_freeze_movements_during_count.sql
-- Freeze stock for items that are part of an ACTIVE stock count, so nothing moves
-- mid-count and corrupts the variance. Enforced at the database so EVERY path is
-- covered (GRN, production, sales, transfers, adjustments, write-offs, etc.).
--
-- A movement is blocked when the product + location it touches appears on a line
-- of a count whose status is still active (open → under review / recount).
-- Exemptions:
--   * the count's own posting movements (ref_type = 'stock_take')
--   * a count flagged manager_override = true (deliberate escape hatch)
--
-- Idempotent — safe to run more than once.

CREATE OR REPLACE FUNCTION block_movement_during_active_count()
RETURNS trigger AS $$
BEGIN
  -- Always allow the stock-count's own postings to write through.
  IF NEW.ref_type = 'stock_take' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stock_take_lines l
    JOIN new_stock_takes t ON t.id = l.stocktake_id
    WHERE t.status IN (
            'open','in_progress','floor_completed','under_review',
            'recount_requested','recount_in_progress'
          )
      AND COALESCE(t.manager_override, false) = false
      AND l.product_id = NEW.product_id
      AND (
            l.location_id IN (NEW.from_location_id, NEW.to_location_id)
            OR (l.location_id IS NULL AND t.location_id IN (NEW.from_location_id, NEW.to_location_id))
          )
  ) THEN
    RAISE EXCEPTION 'Stock movement blocked: "%" is part of an active stock count at this location. Finish or cancel the count first.', COALESCE(NEW.product_name, NEW.product_sku, NEW.product_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_movement_during_count ON stock_movements;
CREATE TRIGGER trg_block_movement_during_count
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION block_movement_during_active_count();
