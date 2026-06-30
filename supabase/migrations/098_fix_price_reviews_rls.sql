-- 098 — Fix invisible Price Variances queue.
--
-- supplier_price_reviews (added in 092) was created with ROW LEVEL SECURITY
-- ENABLED but NO policies — i.e. default-deny — so the app's anon/authenticated
-- roles could SELECT zero rows even though the GRANTs were present. Result: the
-- Review Queue → Price Variances → Pending tab always showed "No price changes to
-- review", hiding every parked invoice variance AND the staged cost-fix proposals.
--
-- Every other table in this app runs with RLS DISABLED (products, supplier_products,
-- purchase_invoice_lines, …) and relies on app-level auth, not Postgres RLS. Bring
-- this table in line so the queue is readable/writable like the rest.

ALTER TABLE supplier_price_reviews DISABLE ROW LEVEL SECURITY;
