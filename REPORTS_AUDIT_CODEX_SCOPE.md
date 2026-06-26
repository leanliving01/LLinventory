# Reports Section — Audit & Fix Review Scope (for Codex)

## Context
React (Vite) + Supabase inventory/production app for a meal-prep business (Lean Living, ZAR, 15% VAT).
Reports live under `src/components/reports/**` and are wired in `src/pages/Reports.jsx` (8 top tabs:
Purchasing, Sales, Inventory, Production, Quality Check, Wastage, Food Cost, Audit Trail; several have sub-tabs).

### Data-access contract (critical to correctness)
All reports read via `base44.entities.<Entity>.list(sortField, limit)` / `.filter(filters, sortField, limit)`
in `src/api/supabaseClient.js`, which maps to `supabase.from(<table>).select('*').order(field).limit(limit)`.
Two silent-failure classes drove most bugs:
1. **Silent empty** — a `sortField` that isn't a real column makes `.order()` error → `list()` returns `[]`
   → the whole report shows nothing, no error surfaced.
2. **Silent wrong number** — `select('*')` always succeeds, so reading a JS field that isn't a real column
   yields `undefined` → coerced to `0`/`NaN`/blank. Wrong column names produce wrong totals silently.

Ground truth = `supabase/schema.sql` (canonical dump) + `supabase/migrations/*.sql` (newer ALTERs).
Key facts: `products.type` (NOT `product_type`), `products.price`/`cost_avg`; `purchase_orders.tax_amount`
(NOT `tax`); `purchase_invoices.subtotal` (ex-VAT) vs `total` (incl-VAT); `goods_received_notes.total_received_value`
is ex-VAT; `production_tasks.status` ∈ {pending,in_progress,paused,done} (NO `completed`) and uses `finished_at`
(NOT `completed_at`); `packing_event_logs.active_seconds` is SECONDS while task durations are MILLISECONDS.

## Fixes applied in this change (please verify each is correct & regression-free)

### Mechanical (wrong column / status / unit)
1. `PurchaseReport.jsx` — VAT card + CSV read `p.tax` → fixed to `p.tax_amount` (card/column were always R0).
2. `StockValuationReport.jsx` — `r.product.product_type` → `r.product.type` + added `TYPE_LABELS` map
   (the whole "by type" breakdown was collapsing to a single "Other" bucket).
3. `StockAgeReport.jsx` — `p?.product_type` → `p?.type`; re-keyed `AGE_THRESHOLDS` from `'Finished Meal'`
   to the real lowercase enum (`finished_meal`, etc.) so the 14-day rule actually applies.
4. `StationThroughputReport.jsx` — `t.status === 'completed'` → `'done'` AND `t.completed_at` → `t.finished_at`
   (report was always empty for BOTH reasons).
5. Seconds→ms: added `formatDurationFromSeconds(sec)` to `src/lib/taskDuration.js` and applied it to all
   dispatch call sites that feed `active_seconds`/`avgSecPerOrder` (seconds) into the ms formatter:
   `dispatch/DispatchStatCards.jsx`, `dispatch/PackerDetailView.jsx`, `dispatch/PackerPerformanceTable.jsx`,
   `employee/EmployeeDetailView.jsx` (ONLY the Dispatch/Packing tiles — the Production tiles there are ms and
   were left on `formatDurationShort`). Times were off by ~1000× (everything showed `0m`/`—`).

### Logic
6. `GRNvsInvoiceReconciliationReport.jsx` — was comparing GRN ex-VAT `total_received_value` against invoice
   incl-VAT `total` → ~15% false variance on every PO. Now compares against invoice `subtotal` (ex-VAT),
   uses a 2% tolerance with an R5 floor, and drops POs with no GRN/invoice activity.
7. `ReportDateFilter.jsx` — custom end-date now normalized to `endOfDay` (+ `isValid` guard), fixing the
   end-of-day off-by-one that dropped the final day across Wastage/Audit/etc.
8. `SalesReport.jsx` — (a) pushed the date range into the query (was capped at newest 1000 rows, hiding
   older in-range orders); (b) order id display/CSV now `order_number || internal_order_number ||
   shopify_order_id` (manual SO- orders showed blank); (c) excludes voided by `status` OR `lifecycle_state`;
   (d) revenue card relabeled "Revenue (incl VAT)"; (e) CSV adds `order_source`.
9. `FoodCostReport.jsx` — revenue now uses ex-VAT `subtotal_price` (was incl-VAT `total_amount`, which made
   Food Cost % understated and margin overstated by the VAT fraction); excludes voided by status OR
   lifecycle_state; pushed date range into the query.
10. `AuditTrailReport.jsx` / `WastageReport.jsx` — pushed date range into the query (were capped at 500/200
    newest rows globally, so older in-range rows were unreachable/unexportable).

### Broken reports rebuilt
11. `YieldEfficiencyReport.jsx` — was joining `portioning_run_lines` on `production_run_id`/`run_id` (neither
    exists; its FK is `portioning_run_id`) and reading `planned_qty`/`actual_qty` (don't exist there). Rebuilt
    to read `production_run_lines` (real `run_id`, `planned_qty`, `actual_qty`) = planned-vs-actual output per run.
12. `LabourCostEstimateReport.jsx` — read `total_meals_portioned`/`labour_hours` off `production_runs` (none
    exist → every row 0) and used TanStack v5-removed `useQuery` `onSuccess` (rate never applied). Rebuilt:
    labour hours derived from `getTaskActiveDuration` summed per `run_id` (ms→hr); meals from `total_units`;
    rate synced from Settings via `useEffect`.

### New reports added (user explicitly wanted Returns reportable)
13. `ReturnsReport.jsx` — off `shopify_returns` (sorted `-return_date`) + `shopify_return_lines`. KPIs: count,
    return value, refunded (paid only), written-off value, qty restocked vs written-off. CSV export.
14. `ResendsReport.jsx` — off `sales_resends` (sorted `-created_date` — table has NO order_date/return_date)
    + `sales_resend_lines`. KPIs: count, value resent (qty×unit_price), sent/completed, stock-deducted,
    reason breakdown. CSV export.
15. `Reports.jsx` — Sales tab converted to sub-tabs: Sales | Returns & Refunds | Re-sends.

Build: `npx vite build` passes (4322 modules). No new lint errors introduced.

## OPEN JUDGMENT CALLS — please advise / verify (deliberately NOT changed yet)
A. **FIFO valuation inconsistency.** `InventoryReport`, `StockValuationReport`, `DeadStockReport` value stock at
   `products.cost_avg`; `StockAgeReport` values at `cost_layers.cost_per_stock_uom`. All products are FIFO, so
   the four reports can disagree on total inventory value. Should all standardize on the FIFO `cost_layers`
   sum? Or is `cost_avg` the intended report basis? (This needs a business call.)
B. **DeadStockReport "last movement"** counts ALL `stock_movements` reasons (incl. receipts), so a received-but-
   never-sold item looks active. Should idleness be measured only against OUTBOUND reasons
   (sale_fulfillment/production_pick/write_off/wastage)? Also it pulls newest-5000 movements globally — a busy
   system can mis-flag items as "Never moved". Server-side `max(created_date) group by product_id` would be safer.
C. **Row-limit truncation** remains on several reports (`Product` capped at 500; SOH/movement/line lists at
   2000–5000). Most read-heavy date-bound ones now push the range into the query, but valuation/age/dead-stock
   still cap. Confirm caps are safe at current data volume or move aggregation server-side.
D. **Missing data surfaced by audit, not yet built:** QC pass-rate % (only raw counts today);
   `production_wastage_events` (production-floor wastage with `total_cost`) is unused by Wastage & Food Cost;
   `stock_write_offs` (finished-stock write-offs) has no report at all. Worth adding?
E. **Cost basis for Food Cost COGS** uses actual `unit_cost_at_movement` on `production_pick` movements vs the
   canonical rolled standard cost in `supabase/functions/cost-rollup`. Actual-cost is defensible but the
   per-unit metric divides COGS (date-filtered picks) by `total_units` (date-filtered runs) with no run↔pick
   linkage — possible skew. Confirm acceptable or link them.
F. **`ResendsReport` "Value Resent"** uses `unit_price` (selling price), not COGS — is that the intended metric
   for re-send cost, or should it be component cost?

## What I want from Codex
1. Verify every column/table/status/enum referenced in my edits exists and is used correctly
   (cross-check against `supabase/schema.sql` + `supabase/migrations/*.sql`). Flag any I got wrong.
2. Check the two rebuilt reports (Yield, Labour) and two new reports (Returns, Re-sends) for correctness,
   silent-empty risk (sort fields), and logic errors.
3. Independent take on the OPEN JUDGMENT CALLS (A–F) — recommend the correct behaviour for this domain.
4. Any report bug the 5-agent audit + my fixes MISSED (other reports: InventoryReport, SupplierSpendAnalysis,
   PurchasePriceVariance, OutstandingPO, QualityCheck, ProductionReport, MemberPerformanceTable, etc.).
