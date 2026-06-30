-- 100 — merge_duplicate_product(keep, drop): fold an accidental duplicate product
-- into the real one. Used to clean up junk twins created when the review-queue
-- matcher failed and a second product was created from invoice wording.
--
-- Repoints the duplicate's references onto the real product and archives the twin
-- (reversible — the twin row is kept). Stock is intentionally NOT moved: an archived
-- product is already excluded from counts, and the duplicates' stock figures are
-- unreliable, so we leave it for a physical count rather than inflate the real product.
--
--   • supplier_products — fold each link into keep (merge known_descriptions, switch
--     off the twin link; or repoint it if keep has no link for that supplier yet)
--   • purchase_invoice_lines — repoint product + supplier_product to keep (cost history)
--   • bom_components — repoint recipe inputs to keep
--   • cost_layers — repoint to keep
--   • products — archive the twin

CREATE OR REPLACE FUNCTION merge_duplicate_product(p_keep text, p_drop text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  r         supplier_products%ROWTYPE;
  v_keep_sp text;
  v_kname   text;
  v_ksku    text;
  v_merged  text[];
BEGIN
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN RETURN 'skip'; END IF;
  SELECT name, sku INTO v_kname, v_ksku FROM products WHERE id = p_keep;
  IF NOT FOUND THEN RETURN 'no-keep'; END IF;

  FOR r IN SELECT * FROM supplier_products WHERE product_id = p_drop LOOP
    SELECT id INTO v_keep_sp
      FROM supplier_products
     WHERE product_id = p_keep AND supplier_id = r.supplier_id
     LIMIT 1;

    IF v_keep_sp IS NOT NULL THEN
      -- keep already linked to this supplier → merge wordings, retire the twin link,
      -- and move the twin link's invoice lines onto keep's link.
      SELECT COALESCE(array_agg(DISTINCT d), '{}') INTO v_merged FROM (
        SELECT unnest(known_descriptions) AS d FROM supplier_products WHERE id = v_keep_sp
        UNION SELECT unnest(r.known_descriptions)
        UNION SELECT r.supplier_description
      ) u WHERE COALESCE(d, '') <> '';
      UPDATE supplier_products SET known_descriptions = v_merged WHERE id = v_keep_sp;
      UPDATE purchase_invoice_lines SET supplier_product_id = v_keep_sp WHERE supplier_product_id = r.id;
      UPDATE supplier_products SET active = false WHERE id = r.id;
    ELSE
      -- keep has no link for this supplier → just repoint the twin's link to keep.
      UPDATE supplier_products
         SET product_id = p_keep, product_name = v_kname, product_sku = v_ksku
       WHERE id = r.id;
    END IF;
  END LOOP;

  UPDATE purchase_invoice_lines
     SET product_id = p_keep, product_name = v_kname, product_sku = v_ksku
   WHERE product_id = p_drop;

  UPDATE bom_components SET input_product_id = p_keep WHERE input_product_id = p_drop;
  UPDATE cost_layers    SET product_id      = p_keep WHERE product_id      = p_drop;

  UPDATE products SET status = 'archived', updated_date = now() WHERE id = p_drop;
  RETURN 'merged';
END;
$$;
