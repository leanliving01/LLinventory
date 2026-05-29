-- Remove all invoices and their lines that were pulled in via Xero sync.
-- Purpose: clear stale data before re-testing the Xero → invoice → PO-match flow.

BEGIN;

-- 1. Delete child lines first (FK is not yet enforced, but delete in correct order)
DELETE FROM purchase_invoice_lines
WHERE invoice_id IN (
  SELECT id FROM purchase_invoices WHERE source = 'xero_sync'
);

-- 2. Delete the parent invoices
DELETE FROM purchase_invoices
WHERE source = 'xero_sync';

COMMIT;
