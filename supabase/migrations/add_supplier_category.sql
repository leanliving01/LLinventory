-- Add category field to suppliers to distinguish food/material suppliers from others
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category text DEFAULT 'other';

CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);

-- Auto-categorise suppliers that have purchase orders linked to food/ingredient products
-- as 'food'. Leaves the rest as 'other' for manual categorisation.
UPDATE suppliers s
SET category = 'food'
WHERE EXISTS (
  SELECT 1
  FROM purchase_orders po
  JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
  JOIN products p ON p.id = pol.product_id
  WHERE po.supplier_id = s.id
    AND p.type IN ('ingredient', 'raw_material')
);

-- Verify
SELECT category, COUNT(*) FROM suppliers GROUP BY category ORDER BY category;
