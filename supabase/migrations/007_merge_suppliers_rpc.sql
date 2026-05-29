-- Allow 'archived' status for suppliers that have been merged into another record.
ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_status_check;
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_status_check
  CHECK (status IN ('active', 'inactive', 'archived'));

-- RPC: merge_suppliers(p_primary_id, p_duplicate_ids[])
-- Atomically migrates all FK references from every duplicate supplier to the
-- primary supplier, then archives the duplicates.  The caller is responsible
-- for applying any field-level conflict resolutions to the primary record
-- BEFORE calling this function.
CREATE OR REPLACE FUNCTION merge_suppliers(
  p_primary_id    text,
  p_duplicate_ids text[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dup_id       text;
  v_primary_name text;
  v_archived     int := 0;
BEGIN
  SELECT name INTO v_primary_name FROM suppliers WHERE id = p_primary_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Primary supplier % not found', p_primary_id;
  END IF;

  FOREACH v_dup_id IN ARRAY p_duplicate_ids LOOP
    IF v_dup_id = p_primary_id THEN
      RAISE EXCEPTION 'Cannot merge a supplier into itself';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = v_dup_id AND status != 'archived') THEN
      RAISE EXCEPTION 'Duplicate supplier % not found or already archived', v_dup_id;
    END IF;

    -- Move all transactional records
    UPDATE purchase_orders
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE goods_received_notes
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE purchase_invoices
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE supplier_products
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE supplier_yield_records
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE supplier_shortages
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE supplier_returns
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE supplier_credit_notes
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE cooking_runs
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    UPDATE yield_records
      SET supplier_id = p_primary_id, supplier_name = v_primary_name
      WHERE supplier_id = v_dup_id;

    -- product_purchase_uoms has supplier_id but no supplier_name column
    UPDATE product_purchase_uoms
      SET supplier_id = p_primary_id
      WHERE supplier_id = v_dup_id;

    -- Legacy supplier_id on products table
    UPDATE products
      SET supplier_id = p_primary_id
      WHERE supplier_id = v_dup_id;

    -- Archive the duplicate — distinct from 'inactive' so it's clearly a merge artefact
    UPDATE suppliers
      SET status       = 'archived',
          updated_date = now()
      WHERE id = v_dup_id;

    v_archived := v_archived + 1;
  END LOOP;

  RETURN json_build_object(
    'status',              'merged',
    'primary_id',          p_primary_id,
    'primary_name',        v_primary_name,
    'duplicates_archived', v_archived
  );
END;
$$;
