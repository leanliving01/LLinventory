-- Link shortages back to the supplier invoice that triggered them
ALTER TABLE supplier_shortages
  ADD COLUMN IF NOT EXISTS invoice_id     text,
  ADD COLUMN IF NOT EXISTS invoice_number text;
