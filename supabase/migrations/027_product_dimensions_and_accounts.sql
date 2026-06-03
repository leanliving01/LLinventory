-- =============================================================================
-- Migration 027 — Product dimensions, weight unit, and local accounting accounts
-- Lean Living ERP — June 2026
-- =============================================================================
-- Adds optional physical dimensions + a weight display unit to products, and a
-- locally-managed chart of accounts (COGS / Inventory / Revenue) so the product
-- form no longer depends on Xero for those dropdowns.
-- RLS is disabled project-wide (migration 022) — new table follows that.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- products — dimensions (cm, optional) + weight display unit
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_cm   numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_cm    numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_cm   numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'g';

-- Constrain weight_unit to g | kg (canonical value still stored in weight_g as grams)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_weight_unit_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_weight_unit_check CHECK (weight_unit IN ('g', 'kg'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- accounting_accounts — locally-managed chart of accounts for products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_accounts (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  account_type  text NOT NULL CHECK (account_type IN ('cogs', 'inventory', 'revenue')),
  code          text,            -- e.g. Xero account code '403' (kept so downstream Xero posting still maps)
  name          text NOT NULL,
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0
);

DROP TRIGGER IF EXISTS trg_accounting_accounts_updated_date ON accounting_accounts;
CREATE TRIGGER trg_accounting_accounts_updated_date
  BEFORE UPDATE ON accounting_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_date();

ALTER TABLE accounting_accounts DISABLE ROW LEVEL SECURITY;

-- Seed the previously hard-coded defaults so nothing regresses (idempotent).
INSERT INTO accounting_accounts (account_type, code, name, is_default, is_active, sort_order)
SELECT account_type, code, name, is_default, true, sort_order
FROM (VALUES
  ('cogs',      '403', 'Cost of Goods Sold', true,  0),
  ('inventory', '715', 'Inventory Asset',    true,  0),
  ('revenue',   '200', 'Sales Revenue',      true,  0)
) AS a(account_type, code, name, is_default, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM accounting_accounts LIMIT 1);
