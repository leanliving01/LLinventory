-- 030_location_address.sql
-- Adds a structured physical address to locations (warehouses / production /
-- delivery locations) so Purchase Orders can show the full delivery address of
-- the selected location, not just its name.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS address_line1 text,   -- building / industrial park
  ADD COLUMN IF NOT EXISTS address_line2 text,   -- street address
  ADD COLUMN IF NOT EXISTS suburb       text,    -- area / suburb
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS province     text,
  ADD COLUMN IF NOT EXISTS postal_code  text;
