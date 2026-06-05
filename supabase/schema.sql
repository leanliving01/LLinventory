-- ============================================================================
-- LLinventory → Supabase schema
-- Source: Base44 entity schemas (lift-and-shift v1; legacy fields preserved)
-- Conventions:
--   - Table names: snake_case plural of entity (Product -> products)
--   - id: text (preserves Base44 IDs to keep FKs valid during migration)
--   - Base44 built-ins: id, created_date, updated_date, created_by
--   - Enums modeled as CHECK constraints (easier to evolve than PG enum types)
--   - FK constraints added AT THE END of this file, after all tables exist
-- ============================================================================

-- Shared trigger: keep updated_date current on UPDATE
CREATE OR REPLACE FUNCTION set_updated_date() RETURNS trigger AS $$
BEGIN
  NEW.updated_date = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- products  (from entity: Product)
-- ============================================================================
CREATE TABLE products (
  -- Base44 built-ins
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  -- Required
  sku           text NOT NULL UNIQUE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN (
                  'raw','packaging','wip_bulk','finished_meal','supplement',
                  'package','sauce','solo_serve','bundle','service')),
  stock_uom     text NOT NULL CHECK (stock_uom IN ('g','kg','ml','L','pcs','box')),

  -- Identification
  barcode       text,
  cin7_id       text,
  external_id   text,
  shopify_product_id text,
  shopify_variant_id text,

  -- Categorization
  category_id    text,   -- FK -> product_categories (added below)
  subcategory_id text,   -- FK -> product_subcategories (added below)
  subcategory    text,   -- LEGACY (replaced by subcategory_id)
  category       text,   -- LEGACY (replaced by category_id)
  pick_category  text CHECK (pick_category IS NULL OR pick_category IN (
                   'Meats','Vegetables','Starches','Spices & Seasoning',
                   'Sauces & Condiments','Dairy & Eggs','Oils & Fats',
                   'Dry Goods','Packaging','Other')),
  tags           text[] NOT NULL DEFAULT '{}',

  -- Behavior flags
  item_type           text NOT NULL DEFAULT 'stock' CHECK (item_type IN (
                        'stock','non_stock','expense','service')),
  inventory_tracked   boolean NOT NULL DEFAULT true,
  sellable            boolean NOT NULL DEFAULT false,
  purchasable         boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),

  -- Units / conversions
  purchase_uom              text,    -- LEGACY (now on supplier_products)
  purchase_to_stock_factor  numeric, -- LEGACY
  recipe_uom                text,

  -- Location
  default_location_id  text,         -- FK -> locations (added below)

  -- Costs & pricing (ZAR)
  cost_avg     numeric NOT NULL DEFAULT 0,
  cost_current numeric NOT NULL DEFAULT 0,
  price        numeric NOT NULL DEFAULT 0,

  -- Reorder / par
  min_before_reorder numeric NOT NULL DEFAULT 0,
  reorder_qty        numeric NOT NULL DEFAULT 0,
  lead_time_days     numeric NOT NULL DEFAULT 0,
  par_level          numeric NOT NULL DEFAULT 0,

  -- LEGACY supplier fields (now on supplier_products)
  supplier_id   text,
  supplier_sku  text,

  -- Physical attributes
  weight_g      numeric,

  -- Descriptive
  description   text,
  internal_note text,

  -- Hierarchy
  parent_product_id text,  -- FK -> products(self) (added below)

  -- Sync / integration
  source_platform  text NOT NULL DEFAULT 'shopify',
  data_hash        text,
  last_synced_at   timestamptz,
  raw_payload      jsonb,             -- promoted from string to jsonb

  -- Xero accounting
  cogs_account      text NOT NULL DEFAULT '403',
  inventory_account text NOT NULL DEFAULT '715',
  revenue_account   text,
  purchase_tax_rule text,
  sale_tax_rule     text,

  -- Yield tracking (production)
  yield_tracking_enabled          boolean NOT NULL DEFAULT false,
  primary_yield_ingredient_id     text,    -- FK -> products(self) (added below)
  primary_yield_ingredient_name   text,
  yield_variance_threshold_pct    numeric NOT NULL DEFAULT 8,

  -- WIP-specific
  shelf_life_hours          numeric,
  minimum_rest_time_hours   numeric NOT NULL DEFAULT 0
                            CHECK (minimum_rest_time_hours = 0 OR minimum_rest_time_hours >= 12)
);

CREATE INDEX idx_products_type               ON products(type);
CREATE INDEX idx_products_status             ON products(status);
CREATE INDEX idx_products_category_id        ON products(category_id);
CREATE INDEX idx_products_subcategory_id     ON products(subcategory_id);
CREATE INDEX idx_products_default_location_id ON products(default_location_id);
CREATE INDEX idx_products_parent_product_id  ON products(parent_product_id);
CREATE INDEX idx_products_shopify_product_id ON products(shopify_product_id);
CREATE INDEX idx_products_external_id        ON products(external_id);

CREATE TRIGGER trg_products_updated_date
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- product_categories  (from entity: ProductCategory)
-- ============================================================================
CREATE TABLE product_categories (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  name         text NOT NULL,
  product_type text NOT NULL CHECK (product_type IN (
                 'raw','packaging','wip_bulk','finished_meal','supplement',
                 'package','sauce','solo_serve','bundle','service')),
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_product_categories_product_type ON product_categories(product_type);
CREATE INDEX idx_product_categories_is_active    ON product_categories(is_active);

CREATE TRIGGER trg_product_categories_updated_date
  BEFORE UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- product_subcategories  (from entity: ProductSubcategory)
-- ============================================================================
CREATE TABLE product_subcategories (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  name           text NOT NULL,
  category_id    text NOT NULL,    -- FK -> product_categories (added below)
  category_name  text,             -- DENORMALIZED from parent (kept for app compat)
  product_type   text NOT NULL CHECK (product_type IN (
                   'raw','packaging','wip_bulk','finished_meal','supplement',
                   'package','sauce','solo_serve','bundle','service')),
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_product_subcategories_category_id  ON product_subcategories(category_id);
CREATE INDEX idx_product_subcategories_product_type ON product_subcategories(product_type);

CREATE TRIGGER trg_product_subcategories_updated_date
  BEFORE UPDATE ON product_subcategories
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- locations  (from entity: Location)
-- ============================================================================
CREATE TABLE locations (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  name                text NOT NULL,
  code                text NOT NULL,
  parent_location_id  text,    -- FK -> locations(self) (added below)
  type                text NOT NULL CHECK (type IN (
                        'ambient','chilled','frozen','production','packing','dispatch')),
  is_stock_bearing    boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX uq_locations_code              ON locations(code);
CREATE INDEX idx_locations_type                    ON locations(type);
CREATE INDEX idx_locations_parent_location_id      ON locations(parent_location_id);

CREATE TRIGGER trg_locations_updated_date
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- units_of_measure  (from entity: UnitOfMeasure)
-- ============================================================================
CREATE TABLE units_of_measure (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  code        text NOT NULL,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('weight','volume','length','count','other')),
  is_default  boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX uq_units_of_measure_code   ON units_of_measure(code);
CREATE INDEX idx_units_of_measure_category     ON units_of_measure(category);
CREATE INDEX idx_units_of_measure_is_default   ON units_of_measure(is_default);

CREATE TRIGGER trg_units_of_measure_updated_date
  BEFORE UPDATE ON units_of_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- boms  (from entity: Bom)
-- ============================================================================
CREATE TABLE boms (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  product_id     text NOT NULL,    -- FK -> products (added below)
  product_name   text,             -- DENORMALIZED (kept for app compat)
  product_sku    text,             -- DENORMALIZED (kept for app compat)
  bom_type       text NOT NULL CHECK (bom_type IN ('cook','portion','pack','prep')),
  subcategory    text,
  yield_qty      numeric NOT NULL DEFAULT 1,
  yield_uom      text,
  pack_color_theme text CHECK (pack_color_theme IS NULL OR pack_color_theme IN (
                     'green','blue','pink','orange','purple','teal')),
  version        integer NOT NULL DEFAULT 1,
  is_active      boolean NOT NULL DEFAULT true,
  cin7_id        text,
  notes          text,
  chef_notes     text,
  files          text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_boms_product_id  ON boms(product_id);
CREATE INDEX idx_boms_bom_type    ON boms(bom_type);
CREATE INDEX idx_boms_is_active   ON boms(is_active);

CREATE TRIGGER trg_boms_updated_date
  BEFORE UPDATE ON boms
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- bom_components  (from entity: BomComponent)
-- ============================================================================
CREATE TABLE bom_components (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  bom_id              text NOT NULL,   -- FK -> boms (added below)
  input_product_id    text NOT NULL,   -- FK -> products (added below)
  input_product_name  text,            -- DENORMALIZED
  input_product_sku   text,            -- DENORMALIZED
  qty                 numeric NOT NULL,
  uom                 text NOT NULL,
  is_consumable       boolean NOT NULL DEFAULT false,
  step_no             integer,         -- soft ref to bom_operations.step_no (same bom_id)
  station             text             -- production layer/phase this ingredient enters at
                      CHECK (station IS NULL OR station IN ('prep','cook','portion','pack')),
  make_day            text NOT NULL DEFAULT 'cook_day'
                      CHECK (make_day IN ('cook_day','portion_day'))
);

CREATE INDEX idx_bom_components_bom_id            ON bom_components(bom_id);
CREATE INDEX idx_bom_components_input_product_id  ON bom_components(input_product_id);
CREATE INDEX idx_bom_components_step              ON bom_components(bom_id, step_no);

CREATE TRIGGER trg_bom_components_updated_date
  BEFORE UPDATE ON bom_components
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- bom_operations  (from entity: BomOperation)
-- ============================================================================
CREATE TABLE bom_operations (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  bom_id          text NOT NULL,    -- FK -> boms (added below)
  step_no         integer NOT NULL,
  name            text NOT NULL,
  station         text NOT NULL CHECK (station IN ('prep','cook','portion')),
  equipment_id    text,             -- FK -> equipment (Equipment entity TBD)
  cycle_time_min  numeric,
  notes           text
);

CREATE UNIQUE INDEX uq_bom_operations_bom_step ON bom_operations(bom_id, step_no);
CREATE INDEX idx_bom_operations_bom_id         ON bom_operations(bom_id);
CREATE INDEX idx_bom_operations_station        ON bom_operations(station);
CREATE INDEX idx_bom_operations_equipment_id   ON bom_operations(equipment_id);

CREATE TRIGGER trg_bom_operations_updated_date
  BEFORE UPDATE ON bom_operations
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- pack_boms  (from entity: PackBom)
-- ============================================================================
CREATE TABLE pack_boms (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  package_sku       text NOT NULL,
  package_type      text NOT NULL CHECK (package_type IN ('goal_based','low_carb','byo','bundle')),
  portion_weight_g  numeric NOT NULL,
  multiplier        numeric NOT NULL,
  component_skus    text[] NOT NULL DEFAULT '{}',
  disabled_skus     text[] NOT NULL DEFAULT '{}',
  sku_overrides     text NOT NULL DEFAULT '{}',   -- JSON-encoded
  pack_color_theme  text CHECK (pack_color_theme IS NULL OR pack_color_theme IN (
                      'green','blue','pink','orange','purple','teal')),
  active            boolean NOT NULL DEFAULT true,
  notes             text
);
CREATE INDEX idx_pack_boms_package_sku  ON pack_boms(package_sku);
CREATE INDEX idx_pack_boms_active       ON pack_boms(active);
CREATE TRIGGER trg_pack_boms_updated_date BEFORE UPDATE ON pack_boms FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 3: SUPPLIERS & PURCHASING
-- ============================================================================

CREATE TABLE suppliers (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  payment_terms text,
  tax_id text,
  default_tax_rule text,
  billing_address text,
  shipping_address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  cin7_id text,
  xero_contact_id text,
  outstanding_balance numeric NOT NULL DEFAULT 0,
  overdue_balance numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_suppliers_status ON suppliers(status);
CREATE TRIGGER trg_suppliers_updated_date BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_products (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  supplier_id text NOT NULL,
  supplier_name text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  supplier_sku text,
  supplier_description text,
  xero_item_code text,
  purchase_uom text NOT NULL CHECK (purchase_uom IN ('case','bag','drum','pallet','box','each','kg','L')),
  purchase_uom_qty numeric NOT NULL DEFAULT 1,
  purchase_uom_label text,
  conversion_uom text,
  conversion_factor numeric NOT NULL DEFAULT 1,
  yield_factor numeric NOT NULL DEFAULT 1.0,
  effective_internal_qty numeric,
  last_purchase_price numeric NOT NULL DEFAULT 0,
  price_variance_threshold numeric NOT NULL DEFAULT 0.1,
  currency text NOT NULL DEFAULT 'ZAR',
  is_default_supplier boolean NOT NULL DEFAULT false,
  lead_time_days numeric NOT NULL DEFAULT 1,
  min_order_qty numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text
);
CREATE INDEX idx_supplier_products_supplier_id ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product_id  ON supplier_products(product_id);
CREATE INDEX idx_supplier_products_xero_item_code ON supplier_products(xero_item_code);
CREATE INDEX idx_supplier_products_active ON supplier_products(active);
CREATE TRIGGER trg_supplier_products_updated_date BEFORE UPDATE ON supplier_products FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_price_histories (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  supplier_product_id text NOT NULL,
  supplier_name text,
  product_name text,
  product_sku text,
  price numeric NOT NULL,
  previous_price numeric,
  change_pct numeric,
  effective_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('purchase_order','invoice','grn','manual_update')),
  source_ref text,
  purchase_uom text
);
CREATE INDEX idx_supplier_price_histories_supplier_product_id ON supplier_price_histories(supplier_product_id);
CREATE INDEX idx_supplier_price_histories_effective_date ON supplier_price_histories(effective_date);
CREATE TRIGGER trg_supplier_price_histories_updated_date BEFORE UPDATE ON supplier_price_histories FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_yield_records (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  supplier_id text NOT NULL,
  supplier_name text,
  supplier_sku text NOT NULL,
  bulk_product_id text NOT NULL,
  bulk_product_name text,
  primary_yield_ingredient_id text,
  primary_yield_ingredient_name text,
  bom_expected_yield_pct numeric,
  latest_approved_yield_pct numeric,
  rolling_avg_yield_pct numeric,
  approved_run_count numeric NOT NULL DEFAULT 0,
  rejected_run_count numeric NOT NULL DEFAULT 0,
  latest_cost_per_cooked_kg numeric,
  rolling_avg_cost_per_cooked_kg numeric,
  bom_expected_cost_per_cooked_kg numeric,
  cost_variance_per_cooked_kg numeric,
  last_production_date date,
  last_purchase_price_per_kg numeric,
  avg_purchase_price_per_kg numeric,
  last_reset_date date,
  last_reset_reason text,
  last_reset_by text,
  auto_reset_due_date date,
  reset_history text,
  significant_variance_count numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_supplier_yield_records_supplier_id ON supplier_yield_records(supplier_id);
CREATE INDEX idx_supplier_yield_records_bulk_product_id ON supplier_yield_records(bulk_product_id);
CREATE TRIGGER trg_supplier_yield_records_updated_date BEFORE UPDATE ON supplier_yield_records FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_shortages (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  grn_id text NOT NULL,
  grn_line_id text,
  supplier_id text NOT NULL,
  supplier_name text,
  supplier_product_id text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  shortage_qty numeric NOT NULL,
  shortage_value numeric,
  purchase_uom text,
  unit_cost numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','follow_up_delivery','credit_received','written_off')),
  resolution_date date,
  resolution_notes text,
  credit_note_number text,
  follow_up_grn_id text
);
CREATE INDEX idx_supplier_shortages_grn_id ON supplier_shortages(grn_id);
CREATE INDEX idx_supplier_shortages_supplier_id ON supplier_shortages(supplier_id);
CREATE INDEX idx_supplier_shortages_status ON supplier_shortages(status);
CREATE TRIGGER trg_supplier_shortages_updated_date BEFORE UPDATE ON supplier_shortages FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_returns (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  return_number text NOT NULL,
  grn_id text NOT NULL,
  supplier_id text NOT NULL,
  supplier_name text,
  return_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending_return' CHECK (status IN (
    'pending_return','returned','credit_received','disputed')),
  total_return_value numeric NOT NULL DEFAULT 0,
  credit_note_number text,
  notes text
);
CREATE INDEX idx_supplier_returns_grn_id ON supplier_returns(grn_id);
CREATE INDEX idx_supplier_returns_supplier_id ON supplier_returns(supplier_id);
CREATE INDEX idx_supplier_returns_status ON supplier_returns(status);
CREATE TRIGGER trg_supplier_returns_updated_date BEFORE UPDATE ON supplier_returns FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE supplier_return_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  return_id text NOT NULL,
  grn_line_id text,
  supplier_product_id text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  return_qty numeric NOT NULL,
  return_value numeric,
  internal_qty_returned numeric,
  reason text NOT NULL CHECK (reason IN ('damaged','wrong_item','quality_issue','expired','other')),
  reason_detail text
);
CREATE INDEX idx_supplier_return_lines_return_id ON supplier_return_lines(return_id);
CREATE TRIGGER trg_supplier_return_lines_updated_date BEFORE UPDATE ON supplier_return_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE purchase_orders (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  po_number text NOT NULL,
  supplier_id text NOT NULL,
  supplier_name text,
  type text NOT NULL DEFAULT 'formal_po' CHECK (type IN ('formal_po','blind_receipt')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','awaiting_approval','approved','partially_received','received',
    'invoiced','closed','cancelled')),
  order_date date,
  expected_date date,
  location_id text,
  location_name text,
  requires_approval boolean NOT NULL DEFAULT false,
  approved_by_name text,
  approved_at timestamptz,
  supplier_invoice_number text,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 0.15,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN (
    'unpaid','paid','overdue','partially_paid')),
  notes text,
  xero_po_id text,
  xero_bill_id text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','xero','blind_receipt')),
  grn_count numeric NOT NULL DEFAULT 0,
  invoice_count numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_purchase_orders_po_number ON purchase_orders(po_number);
CREATE TRIGGER trg_purchase_orders_updated_date BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE purchase_order_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  purchase_order_id text NOT NULL,
  supplier_product_id text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  description text,
  ordered_qty numeric NOT NULL,
  received_qty numeric NOT NULL DEFAULT 0,
  purchase_uom text,
  unit_cost numeric NOT NULL,
  expected_unit_cost numeric,
  price_variance_pct numeric,
  price_variance_flagged boolean NOT NULL DEFAULT false,
  tax_rule text NOT NULL DEFAULT 'VAT 15%',
  line_total numeric NOT NULL DEFAULT 0,
  uom text,  -- LEGACY
  account_code text
);
CREATE INDEX idx_purchase_order_lines_po_id ON purchase_order_lines(purchase_order_id);
CREATE INDEX idx_purchase_order_lines_product_id ON purchase_order_lines(product_id);
CREATE TRIGGER trg_purchase_order_lines_updated_date BEFORE UPDATE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE goods_received_notes (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  grn_number text NOT NULL,
  purchase_order_id text,
  invoice_id text,
  supplier_id text NOT NULL,
  supplier_name text,
  received_date date NOT NULL,
  received_by_name text,
  location_id text NOT NULL,
  location_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','disputed')),
  total_lines numeric NOT NULL DEFAULT 0,
  total_received_value numeric NOT NULL DEFAULT 0,
  has_shortages boolean NOT NULL DEFAULT false,
  has_rejections boolean NOT NULL DEFAULT false,
  notes text
);
CREATE INDEX idx_grns_supplier_id ON goods_received_notes(supplier_id);
CREATE INDEX idx_grns_status ON goods_received_notes(status);
CREATE INDEX idx_grns_po_id ON goods_received_notes(purchase_order_id);
CREATE TRIGGER trg_grns_updated_date BEFORE UPDATE ON goods_received_notes FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE grn_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  grn_id text NOT NULL,
  po_line_id text,
  supplier_product_id text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  expected_qty numeric,
  received_qty numeric NOT NULL,
  variance_qty numeric,
  internal_qty_received numeric,
  purchase_uom text,
  conversion_factor numeric,
  yield_factor numeric NOT NULL DEFAULT 1.0,
  unit_cost numeric,
  line_total numeric,
  batch_number text,
  expiry_date date,
  condition text NOT NULL DEFAULT 'accepted' CHECK (condition IN ('accepted','damaged','rejected')),
  rejection_reason text,
  rejection_qty numeric,
  item_type text NOT NULL DEFAULT 'stock' CHECK (item_type IN ('stock','non_stock','expense','service')),
  price_variance_flagged boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_grn_lines_grn_id ON grn_lines(grn_id);
CREATE INDEX idx_grn_lines_product_id ON grn_lines(product_id);
CREATE TRIGGER trg_grn_lines_updated_date BEFORE UPDATE ON grn_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE purchase_invoices (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  invoice_number text NOT NULL,
  supplier_id text NOT NULL,
  supplier_name text,
  purchase_order_id text,
  grn_id text,
  xero_bill_id text,
  xero_contact_id text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','xero_sync')),
  status text NOT NULL DEFAULT 'pending_match' CHECK (status IN (
    'pending_match','matched','approved','disputed','on_hold')),
  invoice_date date,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  unmatched_line_count numeric NOT NULL DEFAULT 0,
  notes text
);
CREATE INDEX idx_purchase_invoices_supplier_id ON purchase_invoices(supplier_id);
CREATE INDEX idx_purchase_invoices_status ON purchase_invoices(status);
CREATE TRIGGER trg_purchase_invoices_updated_date BEFORE UPDATE ON purchase_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE purchase_invoice_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  invoice_id text NOT NULL,
  xero_line_item_id text,
  xero_item_code text,
  xero_description text,
  supplier_product_id text,
  product_id text,
  product_name text,
  product_sku text,
  qty numeric NOT NULL,
  unit_cost numeric NOT NULL,
  tax_rule text,
  line_total numeric,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN (
    'auto_matched','manually_matched','unmatched','non_stock_item')),
  account_code text
);
CREATE INDEX idx_purchase_invoice_lines_invoice_id ON purchase_invoice_lines(invoice_id);
CREATE INDEX idx_purchase_invoice_lines_match_status ON purchase_invoice_lines(match_status);
CREATE TRIGGER trg_purchase_invoice_lines_updated_date BEFORE UPDATE ON purchase_invoice_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE product_purchase_uoms (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  product_id text NOT NULL,
  label text NOT NULL,
  purchase_to_stock_factor numeric NOT NULL,
  supplier_id text,
  supplier_name text,
  is_default boolean NOT NULL DEFAULT false,
  notes text
);
CREATE INDEX idx_product_purchase_uoms_product_id ON product_purchase_uoms(product_id);
CREATE TRIGGER trg_product_purchase_uoms_updated_date BEFORE UPDATE ON product_purchase_uoms FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 4: SALES, CUSTOMERS, ORDERS
-- ============================================================================

CREATE TABLE sales_orders (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  shopify_order_id text NOT NULL,
  external_id text NOT NULL,
  order_number text,
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_external_id text,
  customer_address text,
  shipping_city text,
  shipping_province text,
  shipping_zip text,
  shipping_country text,
  lifecycle_state text NOT NULL DEFAULT 'pending_payment' CHECK (lifecycle_state IN (
    'pending_payment','paid_unfulfilled','fulfilled','cancelled','refunded')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','picking','packed','shipped','cancelled','refunded')),
  packing_paused boolean NOT NULL DEFAULT false,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN (
    'paid','pending','partially_paid','refunded','voided','authorized','partially_refunded')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN (
    'unfulfilled','fulfilled','partial')),
  order_date timestamptz,
  total_amount numeric NOT NULL DEFAULT 0,
  subtotal_price numeric NOT NULL DEFAULT 0,
  total_tax numeric NOT NULL DEFAULT 0,
  total_discounts numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  cancelled_at timestamptz,
  closed_at timestamptz,
  tags text,
  picking_started_at timestamptz,
  packed_at timestamptz,
  packed_sections text,
  packed_by_name text,
  packed_by_member_id text,
  packing_duration_seconds numeric NOT NULL DEFAULT 0,
  packing_scanned_map text,
  shipped_at timestamptz,
  courier text,
  tracking_number text,
  shipping_cost numeric NOT NULL DEFAULT 0,
  notes text,
  synced_at timestamptz,
  data_hash text,
  source_platform text NOT NULL DEFAULT 'shopify',
  last_synced_at timestamptz,
  raw_payload jsonb,
  has_unresolved_skus boolean NOT NULL DEFAULT false,
  has_unresolved_fulfillment boolean NOT NULL DEFAULT false,
  decomposition_status text NOT NULL DEFAULT 'pending' CHECK (decomposition_status IN (
    'pending','complete','partial','error'))
);
CREATE INDEX idx_sales_orders_status ON sales_orders(status);
CREATE INDEX idx_sales_orders_lifecycle_state ON sales_orders(lifecycle_state);
CREATE INDEX idx_sales_orders_order_date ON sales_orders(order_date);
CREATE UNIQUE INDEX uq_sales_orders_external_id ON sales_orders(external_id);
CREATE TRIGGER trg_sales_orders_updated_date BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE sales_order_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  sales_order_id text NOT NULL,
  external_id text,
  shopify_variant_id text,
  sku text NOT NULL,
  name text,
  variant_title text,
  qty numeric NOT NULL,
  fulfilled_qty numeric NOT NULL DEFAULT 0,
  unit_price numeric,
  line_total numeric NOT NULL DEFAULT 0,
  our_product_id text,
  is_package_parent boolean NOT NULL DEFAULT false,
  is_package_component boolean NOT NULL DEFAULT false,
  parent_line_id text,
  line_type text NOT NULL DEFAULT 'unknown' CHECK (line_type IN (
    'goal_package','low_carb_package','byo','standalone','bundle','bundle_child','unknown')),
  portion_weight_g numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','unresolved_sku','invalid_byo_lc','fulfilled','cancelled')),
  source_platform text NOT NULL DEFAULT 'shopify',
  last_synced_at timestamptz,
  raw_payload jsonb
);
CREATE INDEX idx_sales_order_lines_sales_order_id ON sales_order_lines(sales_order_id);
CREATE INDEX idx_sales_order_lines_sku ON sales_order_lines(sku);
CREATE INDEX idx_sales_order_lines_status ON sales_order_lines(status);
CREATE TRIGGER trg_sales_order_lines_updated_date BEFORE UPDATE ON sales_order_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE decomposed_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  sales_order_id text NOT NULL,
  sales_order_line_id text,
  meal_product_id text NOT NULL,
  meal_sku text,
  meal_name text,
  qty numeric NOT NULL,
  picked_qty numeric NOT NULL DEFAULT 0,
  packed_qty numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_decomposed_lines_sales_order_id ON decomposed_lines(sales_order_id);
CREATE INDEX idx_decomposed_lines_meal_product_id ON decomposed_lines(meal_product_id);
CREATE TRIGGER trg_decomposed_lines_updated_date BEFORE UPDATE ON decomposed_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE committed_demands (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  date date,
  sku_id text NOT NULL,
  sku_display_name text,
  quantity numeric NOT NULL,
  source_order_id text,
  demand_type text NOT NULL CHECK (demand_type IN ('fixed_pack','byo'))
);
CREATE INDEX idx_committed_demands_sku_id ON committed_demands(sku_id);
CREATE INDEX idx_committed_demands_date ON committed_demands(date);
CREATE TRIGGER trg_committed_demands_updated_date BEFORE UPDATE ON committed_demands FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE customers (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  external_id text NOT NULL,
  first_name text,
  last_name text,
  email text NOT NULL,
  phone text,
  total_spent numeric NOT NULL DEFAULT 0,
  orders_count numeric NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}',
  default_address_city text,
  default_address_province text,
  data_hash text,
  source_platform text NOT NULL DEFAULT 'shopify',
  last_synced_at timestamptz,
  raw_payload jsonb
);
CREATE UNIQUE INDEX uq_customers_external_id ON customers(external_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE TRIGGER trg_customers_updated_date BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 5: PRODUCTION (logs, wastage, portioning, QC, write-offs)
-- ============================================================================

CREATE TABLE production_task_logs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  task_id text NOT NULL,
  run_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('started','paused','resumed','completed','undone')),
  station text CHECK (station IS NULL OR station IN ('prep','cook','portion')),
  task_name text,
  assigned_name text,
  assigned_members_names text,
  timestamp timestamptz NOT NULL
);
CREATE INDEX idx_production_task_logs_task_id ON production_task_logs(task_id);
CREATE INDEX idx_production_task_logs_run_id ON production_task_logs(run_id);
CREATE INDEX idx_production_task_logs_timestamp ON production_task_logs(timestamp);
CREATE TRIGGER trg_production_task_logs_updated_date BEFORE UPDATE ON production_task_logs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE production_wastage_events (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  cooking_run_id text NOT NULL,
  cooking_run_number text,
  bulk_product_name text,
  qty_kg numeric NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'burned_overcooked','undercooked_food_safety','contaminated',
    'equipment_failure','handling_dropping','other')),
  description text,
  recorded_by_id text,
  recorded_by_name text,
  recorded_at timestamptz,
  raw_cost_at_event numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  shortfall_created_kg numeric NOT NULL DEFAULT 0,
  top_up_run_id text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected','flagged')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text
);
CREATE INDEX idx_production_wastage_events_cooking_run_id ON production_wastage_events(cooking_run_id);
CREATE INDEX idx_production_wastage_events_review_status ON production_wastage_events(review_status);
CREATE TRIGGER trg_production_wastage_events_updated_date BEFORE UPDATE ON production_wastage_events FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE portioning_runs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  run_number text,
  run_date date NOT NULL,
  production_run_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  staff_assigned_ids text,
  staff_assigned_names text,
  total_meals_portioned numeric NOT NULL DEFAULT 0,
  notes text,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX idx_portioning_runs_run_date ON portioning_runs(run_date);
CREATE INDEX idx_portioning_runs_status ON portioning_runs(status);
CREATE TRIGGER trg_portioning_runs_updated_date BEFORE UPDATE ON portioning_runs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE portioning_run_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  portioning_run_id text NOT NULL,
  bulk_product_id text NOT NULL,
  bulk_product_name text,
  bulk_product_sku text,
  wip_batch_ids text,
  fifo_override_reason text,
  planned_qty_kg numeric NOT NULL,
  opening_qty_kg numeric,
  actual_used_kg numeric,
  closing_qty_kg numeric,
  variance_kg numeric,
  variance_pct numeric,
  recording_method text CHECK (recording_method IS NULL OR recording_method IN ('closing_count','direct_used')),
  qc_override_reason text,
  review_status text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok','variance_flagged','reviewed','rejected')),
  review_notes text,
  meals_portioned numeric NOT NULL DEFAULT 0,
  portion_weight_g numeric
);
CREATE INDEX idx_portioning_run_lines_portioning_run_id ON portioning_run_lines(portioning_run_id);
CREATE INDEX idx_portioning_run_lines_bulk_product_id ON portioning_run_lines(bulk_product_id);
CREATE TRIGGER trg_portioning_run_lines_updated_date BEFORE UPDATE ON portioning_run_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE wip_write_offs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  write_off_number text,
  write_off_type text NOT NULL DEFAULT 'manual' CHECK (write_off_type IN ('bulk_qc','manual')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  write_off_date date,
  total_qty_kg numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN ('quality_deterioration','shelf_life_exceeded','contamination','other')),
  notes text,
  approved_by_id text,
  approved_by_name text,
  confirmed_at timestamptz,
  qc_session_id text,
  lines text,  -- JSON-encoded
  shortfall_alert_shown boolean NOT NULL DEFAULT false,
  shortfall_details text
);
CREATE INDEX idx_wip_write_offs_status ON wip_write_offs(status);
CREATE INDEX idx_wip_write_offs_qc_session_id ON wip_write_offs(qc_session_id);
CREATE TRIGGER trg_wip_write_offs_updated_date BEFORE UPDATE ON wip_write_offs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE wip_quality_checks (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  wip_batch_id text NOT NULL,
  qc_session_id text,
  check_date date NOT NULL,
  check_time timestamptz,
  checked_by_id text,
  checked_by_name text,
  result text NOT NULL CHECK (result IN ('approved','declined')),
  rest_time_overridden boolean NOT NULL DEFAULT false,
  override_reason text,
  notes text
);
CREATE INDEX idx_wip_quality_checks_wip_batch_id ON wip_quality_checks(wip_batch_id);
CREATE INDEX idx_wip_quality_checks_qc_session_id ON wip_quality_checks(qc_session_id);
CREATE TRIGGER trg_wip_quality_checks_updated_date BEFORE UPDATE ON wip_quality_checks FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE quality_check_sessions (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  session_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
  total_batches_checked numeric NOT NULL DEFAULT 0,
  approved_count numeric NOT NULL DEFAULT 0,
  declined_count numeric NOT NULL DEFAULT 0,
  write_off_id text,
  write_off_confirmed boolean NOT NULL DEFAULT false,
  cooking_runs_released boolean NOT NULL DEFAULT false,
  released_cooking_run_ids text,
  confirmed_by_name text,
  confirmed_at timestamptz
);
CREATE INDEX idx_quality_check_sessions_status ON quality_check_sessions(status);
CREATE INDEX idx_quality_check_sessions_session_date ON quality_check_sessions(session_date);
CREATE TRIGGER trg_quality_check_sessions_updated_date BEFORE UPDATE ON quality_check_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE rest_time_override_logs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  wip_batch_id text NOT NULL,
  bulk_product_name text,
  batch_age_hours numeric,
  required_rest_hours numeric,
  authorising_user_name text NOT NULL,
  authorising_user_role text,
  reason text NOT NULL,
  override_timestamp timestamptz,
  qc_session_id text
);
CREATE INDEX idx_rest_time_override_logs_wip_batch_id ON rest_time_override_logs(wip_batch_id);
CREATE TRIGGER trg_rest_time_override_logs_updated_date BEFORE UPDATE ON rest_time_override_logs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 6: STOCK (write-offs, stock takes, wastage logs)
-- ============================================================================

CREATE TABLE stock_write_offs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  write_off_number text,
  write_off_date date,
  effective_date date,
  product_id text NOT NULL,
  product_sku text,
  product_name text,
  qty numeric NOT NULL,
  uom text,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN (
    'quality_deterioration','shelf_life_exceeded','contamination',
    'damaged','stocktake_variance','other')),
  notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed')),
  confirmed_by_name text,
  confirmed_at timestamptz,
  stock_movement_id text
);
CREATE INDEX idx_stock_write_offs_product_id ON stock_write_offs(product_id);
CREATE INDEX idx_stock_write_offs_status ON stock_write_offs(status);
CREATE TRIGGER trg_stock_write_offs_updated_date BEFORE UPDATE ON stock_write_offs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE new_stock_takes (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  stocktake_date date NOT NULL,
  location_id text NOT NULL,
  location_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  manager_override boolean NOT NULL DEFAULT false,
  override_by text,
  override_reason text,
  total_variance_rand numeric NOT NULL DEFAULT 0,
  total_lines numeric NOT NULL DEFAULT 0,
  uncounted_count numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_new_stock_takes_location_id ON new_stock_takes(location_id);
CREATE INDEX idx_new_stock_takes_status ON new_stock_takes(status);
CREATE TRIGGER trg_new_stock_takes_updated_date BEFORE UPDATE ON new_stock_takes FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE stock_take_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  stocktake_id text NOT NULL,
  product_id text NOT NULL,
  product_sku text,
  product_name text,
  system_qty numeric,
  counted_qty numeric NOT NULL,
  variance_qty numeric NOT NULL DEFAULT 0,
  variance_rand numeric NOT NULL DEFAULT 0,
  counted_at timestamptz,
  counted_by text
);
CREATE INDEX idx_stock_take_lines_stocktake_id ON stock_take_lines(stocktake_id);
CREATE INDEX idx_stock_take_lines_product_id ON stock_take_lines(product_id);
CREATE TRIGGER trg_stock_take_lines_updated_date BEFORE UPDATE ON stock_take_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE wastage_logs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  wastage_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','locked')),
  submitted_by text,
  submitted_at timestamptz,
  locked_at timestamptz,
  lock_override_by text,
  total_rand_value numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_wastage_logs_wastage_date ON wastage_logs(wastage_date);
CREATE INDEX idx_wastage_logs_status ON wastage_logs(status);
CREATE TRIGGER trg_wastage_logs_updated_date BEFORE UPDATE ON wastage_logs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE wastage_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  wastage_log_id text NOT NULL,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  qty numeric NOT NULL,
  uom text NOT NULL,
  waste_type text NOT NULL CHECK (waste_type IN ('usable','unusable')),
  reason text,
  rand_value numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_wastage_lines_wastage_log_id ON wastage_lines(wastage_log_id);
CREATE INDEX idx_wastage_lines_product_id ON wastage_lines(product_id);
CREATE TRIGGER trg_wastage_lines_updated_date BEFORE UPDATE ON wastage_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 7: EQUIPMENT
-- ============================================================================

CREATE TABLE equipment (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  equipment_type text NOT NULL,
  location_id text,
  default_capacity numeric,
  default_capacity_uom text CHECK (default_capacity_uom IS NULL OR default_capacity_uom IN ('g','kg','ml','L','pcs','trays')),
  tray_count numeric,
  per_tray_capacity numeric,
  per_tray_uom text CHECK (per_tray_uom IS NULL OR per_tray_uom IN ('g','kg','pcs')),
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired'))
);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_equipment_location_id ON equipment(location_id);
CREATE TRIGGER trg_equipment_updated_date BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE equipment_capacities (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  equipment_id text NOT NULL,
  equipment_name text,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  max_capacity numeric NOT NULL,
  capacity_uom text NOT NULL CHECK (capacity_uom IN ('g','kg','ml','L','pcs','trays')),
  cycle_time_min numeric,
  notes text
);
CREATE INDEX idx_equipment_capacities_equipment_id ON equipment_capacities(equipment_id);
CREATE INDEX idx_equipment_capacities_product_id ON equipment_capacities(product_id);
CREATE TRIGGER trg_equipment_capacities_updated_date BEFORE UPDATE ON equipment_capacities FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 8: SHOPIFY SYNC, SETTINGS, AUDIT
-- ============================================================================

CREATE TABLE shopify_webhook_events (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  topic text NOT NULL,
  shop_domain text NOT NULL,
  external_id text NOT NULL,
  shopify_updated_at text,
  payload jsonb NOT NULL,
  signature text,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed','duplicate')),
  retry_count numeric NOT NULL DEFAULT 0,
  error_message text
);
CREATE INDEX idx_shopify_webhook_events_status ON shopify_webhook_events(status);
CREATE INDEX idx_shopify_webhook_events_topic ON shopify_webhook_events(topic);
CREATE INDEX idx_shopify_webhook_events_external_id ON shopify_webhook_events(external_id);
CREATE TRIGGER trg_shopify_webhook_events_updated_date BEFORE UPDATE ON shopify_webhook_events FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE sync_states (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  source_key text NOT NULL,
  last_cursor text,
  last_sync_at timestamptz,
  sync_status text NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle','running','error','stalled')),
  records_synced numeric NOT NULL DEFAULT 0,
  records_failed numeric NOT NULL DEFAULT 0,
  error_message text,
  webhook_last_received_at timestamptz,
  webhook_backlog_count numeric NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_sync_states_source_key ON sync_states(source_key);
CREATE TRIGGER trg_sync_states_updated_date BEFORE UPDATE ON sync_states FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE reconciliation_mismatches (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  field text NOT NULL,
  shopify_value text NOT NULL,
  base44_value text NOT NULL,
  detected_at timestamptz NOT NULL,
  resolved_at timestamptz,
  auto_corrected boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_reconciliation_mismatches_entity_type ON reconciliation_mismatches(entity_type);
CREATE INDEX idx_reconciliation_mismatches_external_id ON reconciliation_mismatches(external_id);
CREATE TRIGGER trg_reconciliation_mismatches_updated_date BEFORE UPDATE ON reconciliation_mismatches FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- Setting uses "group" which is a Postgres reserved word — quoted everywhere.
CREATE TABLE settings (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  key text NOT NULL,
  value text NOT NULL,
  "group" text NOT NULL CHECK ("group" IN ('org','tax','shopify','cin7','production','alerts','xero')),
  label text
);
CREATE UNIQUE INDEX uq_settings_key ON settings(key);
CREATE INDEX idx_settings_group ON settings("group");
CREATE TRIGGER trg_settings_updated_date BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE help_guides (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  page_key text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  sort_order numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_help_guides_page_key ON help_guides(page_key);
CREATE TRIGGER trg_help_guides_updated_date BEFORE UPDATE ON help_guides FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE bug_reports (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  subject text NOT NULL,
  description text NOT NULL,
  page_route text,
  ai_prompt text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','closed')),
  reporter_name text,
  reporter_email text
);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);
CREATE TRIGGER trg_bug_reports_updated_date BEFORE UPDATE ON bug_reports FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE audit_logs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  action text NOT NULL CHECK (action IN ('create','update','delete','sync','import','finalize','export')),
  entity_type text NOT NULL,
  entity_id text,
  description text NOT NULL,
  old_value text,
  new_value text
);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_date ON audit_logs(created_date);
CREATE TRIGGER trg_audit_logs_updated_date BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE import_logs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  import_type text NOT NULL CHECK (import_type IN ('products','boms','suppliers','stock','full')),
  status text NOT NULL CHECK (status IN ('running','completed','failed','completed_with_warnings')),
  total_records numeric NOT NULL DEFAULT 0,
  created_count numeric NOT NULL DEFAULT 0,
  updated_count numeric NOT NULL DEFAULT 0,
  skipped_count numeric NOT NULL DEFAULT 0,
  error_count numeric NOT NULL DEFAULT 0,
  warnings text[] NOT NULL DEFAULT '{}',
  errors text[] NOT NULL DEFAULT '{}',
  details text,
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX idx_import_logs_import_type ON import_logs(import_type);
CREATE INDEX idx_import_logs_status ON import_logs(status);
CREATE TRIGGER trg_import_logs_updated_date BEFORE UPDATE ON import_logs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE packing_material_rules (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('has_supplements','has_meals','always')),
  materials text,
  material_product_id text,
  material_sku text,
  material_name text,
  deduction_mode text CHECK (deduction_mode IS NULL OR deduction_mode IN ('fixed_per_order','per_x_items')),
  qty_per_deduction numeric NOT NULL DEFAULT 1,
  per_x_items numeric NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  notes text
);
CREATE INDEX idx_packing_material_rules_is_active ON packing_material_rules(is_active);
CREATE TRIGGER trg_packing_material_rules_updated_date BEFORE UPDATE ON packing_material_rules FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 9: LEGACY v1 MEAL / SKU / PACKAGE MODEL  (kept for back-compat)
-- ============================================================================

CREATE TABLE shopify_orders (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  shopify_order_id text NOT NULL,
  order_number text NOT NULL,
  customer_name text,
  paid_status text NOT NULL CHECK (paid_status IN ('paid','unpaid','partially_paid','refunded')),
  fulfilment_status text NOT NULL CHECK (fulfilment_status IN ('unfulfilled','fulfilled','partial','restocked')),
  tags text,
  order_date timestamptz,
  synced_at timestamptz,
  total_meals numeric,
  mwl_meals numeric NOT NULL DEFAULT 0,
  mlm_meals numeric NOT NULL DEFAULT 0,
  wwl_meals numeric NOT NULL DEFAULT 0,
  wlm_meals numeric NOT NULL DEFAULT 0,
  lc_meals numeric NOT NULL DEFAULT 0,
  byo_meals numeric NOT NULL DEFAULT 0,
  is_byo boolean NOT NULL DEFAULT false,
  demand_calculated boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_shopify_orders_order_date ON shopify_orders(order_date);
CREATE TRIGGER trg_shopify_orders_updated_date BEFORE UPDATE ON shopify_orders FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE shopify_order_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  shopify_order_id text NOT NULL,
  shopify_line_item_id text,
  product_title text NOT NULL,
  variant_title text,
  quantity numeric NOT NULL,
  mapped_package_product_id text,
  mapped_sku_id text,
  is_mapped boolean NOT NULL DEFAULT false,
  mapping_type text CHECK (mapping_type IS NULL OR mapping_type IN ('fixed_pack','byo','unmapped')),
  raw_payload jsonb
);
CREATE INDEX idx_shopify_order_lines_shopify_order_id ON shopify_order_lines(shopify_order_id);
CREATE TRIGGER trg_shopify_order_lines_updated_date BEFORE UPDATE ON shopify_order_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE historical_orders (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  shopify_order_id text NOT NULL,
  order_number text,
  order_date timestamptz NOT NULL,
  mwl_meals numeric NOT NULL DEFAULT 0,
  mlm_meals numeric NOT NULL DEFAULT 0,
  wwl_meals numeric NOT NULL DEFAULT 0,
  wlm_meals numeric NOT NULL DEFAULT 0,
  lc_meals numeric NOT NULL DEFAULT 0,
  byo_items text,
  total_meals numeric NOT NULL DEFAULT 0,
  synced_at timestamptz
);
CREATE INDEX idx_historical_orders_order_date ON historical_orders(order_date);
CREATE TRIGGER trg_historical_orders_updated_date BEFORE UPDATE ON historical_orders FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE meals (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  meal_name text NOT NULL,
  family_type text NOT NULL CHECK (family_type IN ('goal_related','low_carb')),
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_meals_family_type ON meals(family_type);
CREATE TRIGGER trg_meals_updated_date BEFORE UPDATE ON meals FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE skus (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  sku_code text NOT NULL,
  meal_id text NOT NULL,
  meal_name text,
  package_type text NOT NULL CHECK (package_type IN ('MWL','MLM','WWL','WLM','LOW_CARB')),
  portion_size_grams numeric,
  display_name text,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_skus_meal_id ON skus(meal_id);
CREATE INDEX idx_skus_sku_code ON skus(sku_code);
CREATE TRIGGER trg_skus_updated_date BEFORE UPDATE ON skus FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE package_products (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  shopify_product_id text,
  shopify_variant_id text,
  shopify_sku text,
  package_family text NOT NULL CHECK (package_family IN ('MWL','MLM','WWL','WLM','LOW_CARB','BYO')),
  pack_size numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_package_products_package_family ON package_products(package_family);
CREATE TRIGGER trg_package_products_updated_date BEFORE UPDATE ON package_products FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE package_bom_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  package_product_id text NOT NULL,
  sku_id text NOT NULL,
  sku_display_name text,
  quantity_per_pack numeric NOT NULL,
  effective_from date,
  effective_to date,
  replacement_reason text,
  is_replacement boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_package_bom_lines_package_product_id ON package_bom_lines(package_product_id);
CREATE INDEX idx_package_bom_lines_sku_id ON package_bom_lines(sku_id);
CREATE TRIGGER trg_package_bom_lines_updated_date BEFORE UPDATE ON package_bom_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE par_levels (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  sku_id text NOT NULL,
  sku_display_name text,
  package_type text CHECK (package_type IS NULL OR package_type IN ('MWL','MLM','WWL','WLM','LOW_CARB')),
  par_level numeric NOT NULL,
  effective_from date
);
CREATE INDEX idx_par_levels_sku_id ON par_levels(sku_id);
CREATE TRIGGER trg_par_levels_updated_date BEFORE UPDATE ON par_levels FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE par_level_recommendations (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  sku_id text NOT NULL,
  sku_display_name text,
  package_type text CHECK (package_type IS NULL OR package_type IN ('MWL','MLM','WWL','WLM','LOW_CARB')),
  current_par_level numeric,
  recommended_par_level numeric NOT NULL,
  avg_weekly_demand numeric,
  safety_buffer_pct numeric NOT NULL DEFAULT 15,
  calculation_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
  notes text
);
CREATE INDEX idx_par_level_recommendations_status ON par_level_recommendations(status);
CREATE TRIGGER trg_par_level_recommendations_updated_date BEFORE UPDATE ON par_level_recommendations FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE stock_snapshots (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  snapshot_date date NOT NULL,
  sku_id text NOT NULL,
  sku_display_name text,
  package_type text CHECK (package_type IS NULL OR package_type IN ('MWL','MLM','WWL','WLM','LOW_CARB')),
  stock_on_hand numeric NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('manual','csv_import','adjustment')),
  notes text
);
CREATE INDEX idx_stock_snapshots_snapshot_date ON stock_snapshots(snapshot_date);
CREATE INDEX idx_stock_snapshots_sku_id ON stock_snapshots(sku_id);
CREATE TRIGGER trg_stock_snapshots_updated_date BEFORE UPDATE ON stock_snapshots FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE product_families (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  family_sku text NOT NULL,
  family_name text NOT NULL,
  option_name text,
  option_values text[],
  variant_product_ids text[]
);
CREATE INDEX idx_product_families_family_sku ON product_families(family_sku);
CREATE TRIGGER trg_product_families_updated_date BEFORE UPDATE ON product_families FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 10: TEAM
-- ============================================================================

CREATE TABLE team_members (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  stations text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  is_manager boolean NOT NULL DEFAULT false,
  manager_pin text
);
CREATE INDEX idx_team_members_is_active ON team_members(is_active);
CREATE INDEX idx_team_members_is_manager ON team_members(is_manager);
CREATE TRIGGER trg_team_members_updated_date BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE dispatch_team_members (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'packer' CHECK (role IN ('packer','checker','dispatcher')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE INDEX idx_dispatch_team_members_status ON dispatch_team_members(status);
CREATE TRIGGER trg_dispatch_team_members_updated_date BEFORE UPDATE ON dispatch_team_members FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 11: PRODUCTION RUNS, PICK LISTS, TASKS
-- ============================================================================

CREATE TABLE production_runs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  run_number text,
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','in_progress','completed','cancelled')),
  type text NOT NULL DEFAULT 'regular' CHECK (type IN ('regular','shortage')),
  parent_run_id text,   -- FK -> production_runs(self) (added below)
  pick_list_confirmed boolean NOT NULL DEFAULT false,
  total_lines numeric NOT NULL DEFAULT 0,
  total_units numeric NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  picking_started_at timestamptz,
  picking_finished_at timestamptz,
  notes text
);
CREATE INDEX idx_production_runs_status ON production_runs(status);
CREATE INDEX idx_production_runs_run_date ON production_runs(run_date);
CREATE INDEX idx_production_runs_parent_run_id ON production_runs(parent_run_id);
CREATE TRIGGER trg_production_runs_updated_date BEFORE UPDATE ON production_runs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE production_run_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  run_id text NOT NULL,
  product_id text NOT NULL,
  product_name text,
  product_sku text,
  planned_qty numeric NOT NULL,
  actual_qty numeric NOT NULL DEFAULT 0,
  variance_reason text CHECK (variance_reason IS NULL OR variance_reason IN (
    'as_planned','higher_yield','lower_yield','power_outage','equipment_failure',
    'ingredient_shortage','recipe_error','staff_error','quality_rejected','other')),
  variance_notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  soh_at_plan numeric NOT NULL DEFAULT 0,
  committed_at_plan numeric NOT NULL DEFAULT 0,
  par_at_plan numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_production_run_lines_run_id ON production_run_lines(run_id);
CREATE INDEX idx_production_run_lines_product_id ON production_run_lines(product_id);
CREATE INDEX idx_production_run_lines_status ON production_run_lines(status);
CREATE TRIGGER trg_production_run_lines_updated_date BEFORE UPDATE ON production_run_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE pick_lists (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  production_run_id text NOT NULL,
  production_run_number text,
  pick_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  completed_at timestamptz,
  total_lines numeric NOT NULL DEFAULT 0,
  released_lines numeric NOT NULL DEFAULT 0
);
CREATE INDEX idx_pick_lists_production_run_id ON pick_lists(production_run_id);
CREATE INDEX idx_pick_lists_status ON pick_lists(status);
CREATE TRIGGER trg_pick_lists_updated_date BEFORE UPDATE ON pick_lists FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE pick_lines (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  pick_list_id text NOT NULL,
  product_id text NOT NULL,
  product_sku text,
  product_name text,
  category_group text,
  from_location_id text,
  from_location_name text,
  required_qty numeric NOT NULL,
  required_uom text NOT NULL,
  actual_qty_picked numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_picked' CHECK (status IN ('not_picked','picked','released')),
  picked_at timestamptz,
  released_at timestamptz,
  release_batch text,
  is_consumable boolean NOT NULL DEFAULT false,
  notes text
);
CREATE INDEX idx_pick_lines_pick_list_id ON pick_lines(pick_list_id);
CREATE INDEX idx_pick_lines_product_id ON pick_lines(product_id);
CREATE INDEX idx_pick_lines_status ON pick_lines(status);
CREATE TRIGGER trg_pick_lines_updated_date BEFORE UPDATE ON pick_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE production_tasks (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  run_id text NOT NULL,
  line_id text,
  product_id text,
  product_sku text,
  meal_name text,
  name text,
  station text NOT NULL CHECK (station IN ('prep','cook','portion')),
  step_no numeric NOT NULL DEFAULT 0,
  qty numeric,
  qty_uom text,
  batch_number numeric NOT NULL DEFAULT 1,
  total_batches numeric NOT NULL DEFAULT 1,
  equipment_id text,
  equipment_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','paused','done')),
  assigned_to text,
  assigned_name text,
  assigned_members text,   -- JSON-encoded array
  assigned_members_names text,
  notes text,
  started_at timestamptz,
  finished_at timestamptz,
  archived boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_production_tasks_run_id ON production_tasks(run_id);
CREATE INDEX idx_production_tasks_line_id ON production_tasks(line_id);
CREATE INDEX idx_production_tasks_station ON production_tasks(station);
CREATE INDEX idx_production_tasks_status ON production_tasks(status);
CREATE INDEX idx_production_tasks_archived ON production_tasks(archived);
CREATE TRIGGER trg_production_tasks_updated_date BEFORE UPDATE ON production_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE task_consumptions (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  task_id text NOT NULL,
  run_id text NOT NULL,
  bom_component_id text,
  input_product_id text NOT NULL,
  input_product_sku text,
  input_product_name text,
  required_qty numeric NOT NULL,
  consumed_qty numeric NOT NULL DEFAULT 0,
  wastage_qty numeric NOT NULL DEFAULT 0,
  uom text NOT NULL,
  wip_batch_id text,
  wip_batch_number text,
  fifo_override_reason text,
  notes text
);
CREATE INDEX idx_task_consumptions_task_id ON task_consumptions(task_id);
CREATE INDEX idx_task_consumptions_run_id ON task_consumptions(run_id);
CREATE INDEX idx_task_consumptions_input_product_id ON task_consumptions(input_product_id);
CREATE INDEX idx_task_consumptions_wip_batch_id ON task_consumptions(wip_batch_id);
CREATE TRIGGER trg_task_consumptions_updated_date BEFORE UPDATE ON task_consumptions FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 12: COOKING RUNS, WIP BATCHES, YIELD
-- ============================================================================

CREATE TABLE cooking_runs (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  run_number text,
  run_type text NOT NULL DEFAULT 'standard' CHECK (run_type IN ('standard','top_up')),
  parent_run_id text,   -- FK -> cooking_runs(self)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','released','in_progress','pending_review','completed','cancelled')),
  run_date date,
  bulk_product_id text NOT NULL,
  bulk_product_name text,
  bulk_product_sku text,
  cook_bom_id text,
  target_output_kg numeric NOT NULL,
  planned_raw_kg numeric,
  bom_expected_yield_pct numeric,
  supplier_id text,
  supplier_name text,
  supplier_sku text,
  raw_product_id text,
  raw_product_name text,
  raw_cost_per_kg numeric NOT NULL DEFAULT 0,
  batch_grn text,
  actual_raw_issued_kg numeric,
  actual_cooked_output_kg numeric,
  total_wastage_kg numeric NOT NULL DEFAULT 0,
  effective_raw_for_yield_kg numeric,
  yield_shrinkage_kg numeric,
  actual_yield_pct numeric,
  yield_variance_pct numeric,
  actual_cost_per_cooked_kg numeric,
  bom_expected_cost_per_cooked_kg numeric,
  assigned_staff_id text,
  assigned_staff_name text,
  production_manager_id text,
  production_manager_name text,
  production_run_id text,
  contributing_run_ids text,   -- JSON array as text
  notes text,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX idx_cooking_runs_status ON cooking_runs(status);
CREATE INDEX idx_cooking_runs_run_date ON cooking_runs(run_date);
CREATE INDEX idx_cooking_runs_bulk_product_id ON cooking_runs(bulk_product_id);
CREATE INDEX idx_cooking_runs_parent_run_id ON cooking_runs(parent_run_id);
CREATE INDEX idx_cooking_runs_production_run_id ON cooking_runs(production_run_id);
CREATE TRIGGER trg_cooking_runs_updated_date BEFORE UPDATE ON cooking_runs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE wip_batches (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  batch_number text,
  bulk_product_id text NOT NULL,
  bulk_product_name text,
  bulk_product_sku text,
  qty_kg numeric NOT NULL,
  original_qty_kg numeric,
  produced_date date NOT NULL,
  cooking_run_id text NOT NULL,
  supplier_sku text,
  supplier_name text,
  batch_grn text,
  carrying_cost_per_kg numeric NOT NULL DEFAULT 0,
  total_carrying_value numeric NOT NULL DEFAULT 0,
  quality_status text NOT NULL DEFAULT 'fresh' CHECK (quality_status IN (
    'fresh','use_today','quarantine','written_off')),
  last_qc_date date,
  last_qc_by text,
  expiry_at timestamptz,
  rest_time_met boolean NOT NULL DEFAULT true,
  rest_ready_at timestamptz,
  notes text
);
CREATE INDEX idx_wip_batches_bulk_product_id ON wip_batches(bulk_product_id);
CREATE INDEX idx_wip_batches_cooking_run_id ON wip_batches(cooking_run_id);
CREATE INDEX idx_wip_batches_quality_status ON wip_batches(quality_status);
CREATE INDEX idx_wip_batches_produced_date ON wip_batches(produced_date);
CREATE TRIGGER trg_wip_batches_updated_date BEFORE UPDATE ON wip_batches FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE yield_records (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  cooking_run_id text,
  production_run_id text,
  task_id text,
  production_date date NOT NULL,
  station text NOT NULL CHECK (station IN ('prep','cook')),
  run_type text CHECK (run_type IS NULL OR run_type IN ('standard','top_up_merged','top_up_independent')),
  bulk_product_id text NOT NULL,
  bulk_product_name text,
  bulk_product_sku text,
  input_product_id text,
  input_product_name text,
  input_product_sku text,
  primary_yield_ingredient_id text,
  primary_yield_ingredient_name text,
  supplier_id text,
  supplier_name text,
  supplier_sku text,
  required_qty numeric,
  consumed_qty numeric,
  wastage_qty numeric NOT NULL DEFAULT 0,
  uom text,
  bom_planned_raw_kg numeric,
  bom_planned_cooked_kg numeric,
  bom_expected_yield_pct numeric,
  actual_raw_issued_kg numeric,
  wastage_qty_kg numeric NOT NULL DEFAULT 0,
  effective_raw_for_yield_kg numeric,
  actual_cooked_output_kg numeric,
  actual_yield_pct numeric,
  yield_variance_pct numeric,
  raw_cost_per_kg numeric,
  actual_cost_per_cooked_kg numeric,
  bom_expected_cost_per_cooked_kg numeric,
  cost_variance_per_cooked_kg numeric,
  rolling_avg_yield_pct numeric,
  recorded_by_name text,
  production_notes text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN (
    'recorded','pending_review','approved_record_only','approved_update_average',
    'approved_do_not_update','rejected','flagged_unusual','pending_recapture')),
  significant_variance_flag boolean NOT NULL DEFAULT false,
  variance_threshold_pct numeric,
  pm_review_notes text,
  pm_reviewed_by text,
  pm_reviewed_at timestamptz,
  rejection_notes text,
  recapture_history text,   -- JSON array as text
  merged_run_ids text       -- JSON array as text
);
CREATE INDEX idx_yield_records_cooking_run_id ON yield_records(cooking_run_id);
CREATE INDEX idx_yield_records_production_run_id ON yield_records(production_run_id);
CREATE INDEX idx_yield_records_task_id ON yield_records(task_id);
CREATE INDEX idx_yield_records_production_date ON yield_records(production_date);
CREATE INDEX idx_yield_records_status ON yield_records(status);
CREATE INDEX idx_yield_records_bulk_product_id ON yield_records(bulk_product_id);
CREATE TRIGGER trg_yield_records_updated_date BEFORE UPDATE ON yield_records FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- SLICE 13: STOCK ON HAND & STOCK MOVEMENTS
-- ============================================================================

-- Note: stock_on_hand is derived from stock_movements. It exists as a table for
-- fast reads. Keep it consistent via app logic or, later, materialized view + trigger.
CREATE TABLE stock_on_hand (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  product_id text NOT NULL,
  product_sku text,
  product_name text,
  location_id text NOT NULL,
  location_name text,
  qty_on_hand numeric NOT NULL DEFAULT 0,
  qty_committed numeric NOT NULL DEFAULT 0,
  qty_available numeric NOT NULL DEFAULT 0,
  uom text,
  last_updated_at timestamptz
);
CREATE UNIQUE INDEX uq_stock_on_hand_product_location ON stock_on_hand(product_id, location_id);
CREATE INDEX idx_stock_on_hand_product_id ON stock_on_hand(product_id);
CREATE INDEX idx_stock_on_hand_location_id ON stock_on_hand(location_id);
CREATE TRIGGER trg_stock_on_hand_updated_date BEFORE UPDATE ON stock_on_hand FOR EACH ROW EXECUTE FUNCTION set_updated_date();

CREATE TABLE stock_movements (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  product_id text NOT NULL,
  product_sku text,
  product_name text,
  from_location_id text,
  to_location_id text,
  qty numeric NOT NULL,
  uom text NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'receipt','transfer','production_consume','production_yield','production_pick',
    'production_return','sale_fulfillment','wastage_usable','wastage_unusable',
    'stocktake_adjustment','return','supplier_return','cancellation_reversal',
    'write_off','packing_material')),
  ref_type text CHECK (ref_type IS NULL OR ref_type IN (
    'sales_order','purchase_order','production_run','wastage_log','stock_take',
    'transfer','grn','supplier_return','pick_list','manual')),
  ref_id text,
  ref_number text,
  reference_key text,   -- idempotency key
  unit_cost_at_movement numeric NOT NULL DEFAULT 0,
  notes text
);
CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_from_location_id ON stock_movements(from_location_id);
CREATE INDEX idx_stock_movements_to_location_id ON stock_movements(to_location_id);
CREATE INDEX idx_stock_movements_reason ON stock_movements(reason);
CREATE INDEX idx_stock_movements_ref ON stock_movements(ref_type, ref_id);
CREATE UNIQUE INDEX uq_stock_movements_reference_key ON stock_movements(reference_key) WHERE reference_key IS NOT NULL;
CREATE INDEX idx_stock_movements_created_date ON stock_movements(created_date);
CREATE TRIGGER trg_stock_movements_updated_date BEFORE UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ============================================================================
-- AUTH NOTE
-- ============================================================================
-- The Base44 `User` entity (role, station, permissions) is NOT migrated as a
-- table here. It maps to Supabase Auth (auth.users) plus a future
-- `user_profiles` table joined by uuid. We'll add that during Phase C
-- (code/auth migration).

-- ============================================================================
-- FOREIGN KEY CONSTRAINTS  (added after ALL tables exist + data imported)
-- ============================================================================
-- Add these only AFTER data import — they will validate that every FK points
-- to a real row. If any orphan rows exist, ALTER TABLE will fail and tell us.

-- products
-- ALTER TABLE products ADD CONSTRAINT fk_products_category
--   FOREIGN KEY (category_id) REFERENCES product_categories(id);
-- ALTER TABLE products ADD CONSTRAINT fk_products_subcategory
--   FOREIGN KEY (subcategory_id) REFERENCES product_subcategories(id);
-- ALTER TABLE products ADD CONSTRAINT fk_products_location
--   FOREIGN KEY (default_location_id) REFERENCES locations(id);
-- ALTER TABLE products ADD CONSTRAINT fk_products_parent
--   FOREIGN KEY (parent_product_id) REFERENCES products(id);
-- ALTER TABLE products ADD CONSTRAINT fk_products_yield_ingredient
--   FOREIGN KEY (primary_yield_ingredient_id) REFERENCES products(id);

-- product_subcategories
-- ALTER TABLE product_subcategories ADD CONSTRAINT fk_product_subcategories_category
--   FOREIGN KEY (category_id) REFERENCES product_categories(id);

-- locations
-- ALTER TABLE locations ADD CONSTRAINT fk_locations_parent
--   FOREIGN KEY (parent_location_id) REFERENCES locations(id);

-- boms
-- ALTER TABLE boms ADD CONSTRAINT fk_boms_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- bom_components
-- ALTER TABLE bom_components ADD CONSTRAINT fk_bom_components_bom
--   FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE;
-- ALTER TABLE bom_components ADD CONSTRAINT fk_bom_components_input_product
--   FOREIGN KEY (input_product_id) REFERENCES products(id);

-- bom_operations
-- ALTER TABLE bom_operations ADD CONSTRAINT fk_bom_operations_bom
--   FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE;
-- ALTER TABLE bom_operations ADD CONSTRAINT fk_bom_operations_equipment
--   FOREIGN KEY (equipment_id) REFERENCES equipment(id);

-- supplier_products
-- ALTER TABLE supplier_products ADD CONSTRAINT fk_supplier_products_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE supplier_products ADD CONSTRAINT fk_supplier_products_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- supplier_price_histories
-- ALTER TABLE supplier_price_histories ADD CONSTRAINT fk_supplier_price_histories_sp
--   FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id);

-- supplier_yield_records
-- ALTER TABLE supplier_yield_records ADD CONSTRAINT fk_supplier_yield_records_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE supplier_yield_records ADD CONSTRAINT fk_supplier_yield_records_bulk
--   FOREIGN KEY (bulk_product_id) REFERENCES products(id);

-- supplier_shortages
-- ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_grn
--   FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);
-- ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- supplier_returns
-- ALTER TABLE supplier_returns ADD CONSTRAINT fk_supplier_returns_grn
--   FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);
-- ALTER TABLE supplier_returns ADD CONSTRAINT fk_supplier_returns_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

-- supplier_return_lines
-- ALTER TABLE supplier_return_lines ADD CONSTRAINT fk_supplier_return_lines_return
--   FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE;
-- ALTER TABLE supplier_return_lines ADD CONSTRAINT fk_supplier_return_lines_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- purchase_orders
-- ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_location
--   FOREIGN KEY (location_id) REFERENCES locations(id);

-- purchase_order_lines
-- ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_po
--   FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
-- ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_supplier_product
--   FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id);

-- goods_received_notes
-- ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_po
--   FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);
-- ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_location
--   FOREIGN KEY (location_id) REFERENCES locations(id);

-- grn_lines
-- ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_grn
--   FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id) ON DELETE CASCADE;
-- ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_po_line
--   FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines(id);
-- ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- purchase_invoices
-- ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_po
--   FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);
-- ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_grn
--   FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);

-- purchase_invoice_lines
-- ALTER TABLE purchase_invoice_lines ADD CONSTRAINT fk_pil_invoice
--   FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE;
-- ALTER TABLE purchase_invoice_lines ADD CONSTRAINT fk_pil_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- product_purchase_uoms
-- ALTER TABLE product_purchase_uoms ADD CONSTRAINT fk_ppu_product
--   FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
-- ALTER TABLE product_purchase_uoms ADD CONSTRAINT fk_ppu_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

-- sales_order_lines
-- ALTER TABLE sales_order_lines ADD CONSTRAINT fk_sol_sales_order
--   FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
-- ALTER TABLE sales_order_lines ADD CONSTRAINT fk_sol_product
--   FOREIGN KEY (our_product_id) REFERENCES products(id);

-- decomposed_lines
-- ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_sales_order
--   FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
-- ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_sales_order_line
--   FOREIGN KEY (sales_order_line_id) REFERENCES sales_order_lines(id);
-- ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_meal_product
--   FOREIGN KEY (meal_product_id) REFERENCES products(id);

-- production_runs (self-ref)
-- ALTER TABLE production_runs ADD CONSTRAINT fk_production_runs_parent
--   FOREIGN KEY (parent_run_id) REFERENCES production_runs(id);

-- production_run_lines
-- ALTER TABLE production_run_lines ADD CONSTRAINT fk_prl_run
--   FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE;
-- ALTER TABLE production_run_lines ADD CONSTRAINT fk_prl_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- pick_lists
-- ALTER TABLE pick_lists ADD CONSTRAINT fk_pick_lists_run
--   FOREIGN KEY (production_run_id) REFERENCES production_runs(id);

-- pick_lines
-- ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_list
--   FOREIGN KEY (pick_list_id) REFERENCES pick_lists(id) ON DELETE CASCADE;
-- ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_location
--   FOREIGN KEY (from_location_id) REFERENCES locations(id);

-- production_tasks
-- ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_run
--   FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE;
-- ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_line
--   FOREIGN KEY (line_id) REFERENCES production_run_lines(id);
-- ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_equipment
--   FOREIGN KEY (equipment_id) REFERENCES equipment(id);
-- ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_team_member
--   FOREIGN KEY (assigned_to) REFERENCES team_members(id);

-- task_consumptions
-- ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_task
--   FOREIGN KEY (task_id) REFERENCES production_tasks(id) ON DELETE CASCADE;
-- ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_run
--   FOREIGN KEY (run_id) REFERENCES production_runs(id);
-- ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_bom_component
--   FOREIGN KEY (bom_component_id) REFERENCES bom_components(id);
-- ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_product
--   FOREIGN KEY (input_product_id) REFERENCES products(id);
-- ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_wip_batch
--   FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);

-- cooking_runs (self-ref + many)
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_parent
--   FOREIGN KEY (parent_run_id) REFERENCES cooking_runs(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_bulk_product
--   FOREIGN KEY (bulk_product_id) REFERENCES products(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_cook_bom
--   FOREIGN KEY (cook_bom_id) REFERENCES boms(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_raw_product
--   FOREIGN KEY (raw_product_id) REFERENCES products(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_assigned_staff
--   FOREIGN KEY (assigned_staff_id) REFERENCES team_members(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_production_manager
--   FOREIGN KEY (production_manager_id) REFERENCES team_members(id);
-- ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_production_run
--   FOREIGN KEY (production_run_id) REFERENCES production_runs(id);

-- wip_batches
-- ALTER TABLE wip_batches ADD CONSTRAINT fk_wb_bulk_product
--   FOREIGN KEY (bulk_product_id) REFERENCES products(id);
-- ALTER TABLE wip_batches ADD CONSTRAINT fk_wb_cooking_run
--   FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);

-- yield_records
-- ALTER TABLE yield_records ADD CONSTRAINT fk_yr_cooking_run
--   FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);
-- ALTER TABLE yield_records ADD CONSTRAINT fk_yr_production_run
--   FOREIGN KEY (production_run_id) REFERENCES production_runs(id);
-- ALTER TABLE yield_records ADD CONSTRAINT fk_yr_task
--   FOREIGN KEY (task_id) REFERENCES production_tasks(id);
-- ALTER TABLE yield_records ADD CONSTRAINT fk_yr_bulk_product
--   FOREIGN KEY (bulk_product_id) REFERENCES products(id);
-- ALTER TABLE yield_records ADD CONSTRAINT fk_yr_supplier
--   FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

-- stock_on_hand
-- ALTER TABLE stock_on_hand ADD CONSTRAINT fk_soh_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE stock_on_hand ADD CONSTRAINT fk_soh_location
--   FOREIGN KEY (location_id) REFERENCES locations(id);

-- stock_movements
-- ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_from_location
--   FOREIGN KEY (from_location_id) REFERENCES locations(id);
-- ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_to_location
--   FOREIGN KEY (to_location_id) REFERENCES locations(id);

-- production_task_logs
-- ALTER TABLE production_task_logs ADD CONSTRAINT fk_ptl_task
--   FOREIGN KEY (task_id) REFERENCES production_tasks(id) ON DELETE CASCADE;
-- ALTER TABLE production_task_logs ADD CONSTRAINT fk_ptl_run
--   FOREIGN KEY (run_id) REFERENCES production_runs(id);

-- production_wastage_events
-- ALTER TABLE production_wastage_events ADD CONSTRAINT fk_pwe_cooking_run
--   FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);

-- portioning_runs
-- ALTER TABLE portioning_runs ADD CONSTRAINT fk_por_production_run
--   FOREIGN KEY (production_run_id) REFERENCES production_runs(id);

-- portioning_run_lines
-- ALTER TABLE portioning_run_lines ADD CONSTRAINT fk_porl_portioning_run
--   FOREIGN KEY (portioning_run_id) REFERENCES portioning_runs(id) ON DELETE CASCADE;
-- ALTER TABLE portioning_run_lines ADD CONSTRAINT fk_porl_bulk_product
--   FOREIGN KEY (bulk_product_id) REFERENCES products(id);

-- wip_quality_checks
-- ALTER TABLE wip_quality_checks ADD CONSTRAINT fk_wqc_wip_batch
--   FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);
-- ALTER TABLE wip_quality_checks ADD CONSTRAINT fk_wqc_qc_session
--   FOREIGN KEY (qc_session_id) REFERENCES quality_check_sessions(id);

-- rest_time_override_logs
-- ALTER TABLE rest_time_override_logs ADD CONSTRAINT fk_rtol_wip_batch
--   FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);
-- ALTER TABLE rest_time_override_logs ADD CONSTRAINT fk_rtol_qc_session
--   FOREIGN KEY (qc_session_id) REFERENCES quality_check_sessions(id);

-- stock_write_offs
-- ALTER TABLE stock_write_offs ADD CONSTRAINT fk_swo_product
--   FOREIGN KEY (product_id) REFERENCES products(id);
-- ALTER TABLE stock_write_offs ADD CONSTRAINT fk_swo_stock_movement
--   FOREIGN KEY (stock_movement_id) REFERENCES stock_movements(id);

-- new_stock_takes
-- ALTER TABLE new_stock_takes ADD CONSTRAINT fk_nst_location
--   FOREIGN KEY (location_id) REFERENCES locations(id);

-- stock_take_lines
-- ALTER TABLE stock_take_lines ADD CONSTRAINT fk_stl_stocktake
--   FOREIGN KEY (stocktake_id) REFERENCES new_stock_takes(id) ON DELETE CASCADE;
-- ALTER TABLE stock_take_lines ADD CONSTRAINT fk_stl_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- wastage_lines
-- ALTER TABLE wastage_lines ADD CONSTRAINT fk_wl_wastage_log
--   FOREIGN KEY (wastage_log_id) REFERENCES wastage_logs(id) ON DELETE CASCADE;
-- ALTER TABLE wastage_lines ADD CONSTRAINT fk_wl_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- equipment
-- ALTER TABLE equipment ADD CONSTRAINT fk_equipment_location
--   FOREIGN KEY (location_id) REFERENCES locations(id);

-- equipment_capacities
-- ALTER TABLE equipment_capacities ADD CONSTRAINT fk_ec_equipment
--   FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE;
-- ALTER TABLE equipment_capacities ADD CONSTRAINT fk_ec_product
--   FOREIGN KEY (product_id) REFERENCES products(id);

-- Legacy v1 tables (shopify_orders, meals, skus, package_*, par_levels, etc.)
-- intentionally omitted from FK constraints — these are being phased out.
