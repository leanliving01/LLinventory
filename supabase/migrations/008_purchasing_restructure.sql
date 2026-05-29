-- ================================================================
-- Migration 008: Purchasing Restructure
-- Extends suppliers, adds supplier_contacts, extends supplier_products,
-- migrates product_purchase_uoms data, extends grn_lines,
-- supplier_returns, and supplier_shortages.
-- All statements are idempotent (IF NOT EXISTS throughout).
-- ================================================================

-- 1. Extend suppliers table
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_vat_registered boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS physical_address text;

-- 2. Create supplier_contacts table
CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text,
  phone       text,
  role        text CHECK (role IN ('accounts','sales','delivery','representative','general','other')),
  is_primary  boolean DEFAULT false,
  notes       text,
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now(),
  created_by   text
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier_id
  ON supplier_contacts(supplier_id);

DROP TRIGGER IF EXISTS trg_supplier_contacts_updated_date ON supplier_contacts;
CREATE TRIGGER trg_supplier_contacts_updated_date
  BEFORE UPDATE ON supplier_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 3. Extend supplier_products (canonical single source of truth)
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS nominal_cost         numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_uom_name    text,
  ADD COLUMN IF NOT EXISTS price_per_stock_unit numeric DEFAULT 0;

-- 4. Add unique constraint needed for ON CONFLICT below
ALTER TABLE supplier_products
  ADD CONSTRAINT IF NOT EXISTS uq_supplier_products_product_supplier
  UNIQUE (product_id, supplier_id);

-- 5. Migrate product_purchase_uoms → supplier_products
INSERT INTO supplier_products (
  id, product_id, supplier_id, supplier_name, product_name, product_sku,
  purchase_uom_label, purchase_uom_name, conversion_factor,
  last_purchase_price, nominal_cost,
  supplier_sku, supplier_description,
  is_default_supplier, active,
  created_date, updated_date, created_by
)
SELECT
  gen_random_uuid()::text,
  ppu.product_id,
  ppu.supplier_id,
  ppu.supplier_name,
  p.name,
  p.sku,
  COALESCE(ppu.label, ppu.purchase_uom_name),
  ppu.purchase_uom_name,
  COALESCE(ppu.conversion_factor, ppu.purchase_to_stock_factor, 1),
  COALESCE(ppu.price_per_purchase_uom, 0),
  COALESCE(ppu.price_per_purchase_uom, 0),
  ppu.supplier_sku,
  ppu.supplier_description,
  COALESCE(ppu.is_default, false),
  true,
  ppu.created_date,
  ppu.updated_date,
  ppu.created_by
FROM product_purchase_uoms ppu
JOIN products p ON p.id = ppu.product_id
WHERE ppu.supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;

-- 6. Extend grn_lines
ALTER TABLE grn_lines
  ADD COLUMN IF NOT EXISTS short_receival_action text
    CHECK (short_receival_action IN ('receive_later','request_credit'));

-- 7. Extend supplier_returns
ALTER TABLE supplier_returns
  ADD COLUMN IF NOT EXISTS credit_expected boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS po_id      text REFERENCES purchase_orders(id),
  ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES purchase_invoices(id),
  ADD COLUMN IF NOT EXISTS stock_action text
    CHECK (stock_action IN ('remove_from_stock','move_to_quarantine','already_returned'));

-- 8. Extend supplier_shortages
ALTER TABLE supplier_shortages
  ADD COLUMN IF NOT EXISTS credit_follow_up_status text DEFAULT 'credit_required'
    CHECK (credit_follow_up_status IN (
      'credit_required','credit_requested','credit_note_received',
      'partially_credited','matched','cancelled'
    ));
