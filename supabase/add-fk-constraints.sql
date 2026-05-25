-- ============================================================================
-- ADD FOREIGN KEY CONSTRAINTS
-- Run this in Supabase SQL Editor after data import is complete.
--
-- Each constraint is wrapped in its own error handler. If one fails (usually
-- because some rows were skipped during migration), it prints a NOTICE and
-- continues — so all valid constraints still get added.
-- ============================================================================

-- products
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES product_categories(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_products_category: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT fk_products_subcategory
    FOREIGN KEY (subcategory_id) REFERENCES product_subcategories(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_products_subcategory: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT fk_products_location
    FOREIGN KEY (default_location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_products_location: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT fk_products_parent
    FOREIGN KEY (parent_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_products_parent: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT fk_products_yield_ingredient
    FOREIGN KEY (primary_yield_ingredient_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_products_yield_ingredient: %', SQLERRM; END $$;

-- product_subcategories
DO $$ BEGIN
  ALTER TABLE product_subcategories ADD CONSTRAINT fk_product_subcategories_category
    FOREIGN KEY (category_id) REFERENCES product_categories(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_product_subcategories_category: %', SQLERRM; END $$;

-- locations
DO $$ BEGIN
  ALTER TABLE locations ADD CONSTRAINT fk_locations_parent
    FOREIGN KEY (parent_location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_locations_parent: %', SQLERRM; END $$;

-- boms
DO $$ BEGIN
  ALTER TABLE boms ADD CONSTRAINT fk_boms_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_boms_product: %', SQLERRM; END $$;

-- bom_components
DO $$ BEGIN
  ALTER TABLE bom_components ADD CONSTRAINT fk_bom_components_bom
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_bom_components_bom: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE bom_components ADD CONSTRAINT fk_bom_components_input_product
    FOREIGN KEY (input_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_bom_components_input_product: %', SQLERRM; END $$;

-- bom_operations
DO $$ BEGIN
  ALTER TABLE bom_operations ADD CONSTRAINT fk_bom_operations_bom
    FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_bom_operations_bom: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE bom_operations ADD CONSTRAINT fk_bom_operations_equipment
    FOREIGN KEY (equipment_id) REFERENCES equipment(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_bom_operations_equipment: %', SQLERRM; END $$;

-- supplier_products
DO $$ BEGIN
  ALTER TABLE supplier_products ADD CONSTRAINT fk_supplier_products_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_products_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_products ADD CONSTRAINT fk_supplier_products_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_products_product: %', SQLERRM; END $$;

-- supplier_price_histories
DO $$ BEGIN
  ALTER TABLE supplier_price_histories ADD CONSTRAINT fk_supplier_price_histories_sp
    FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_price_histories_sp: %', SQLERRM; END $$;

-- supplier_yield_records
DO $$ BEGIN
  ALTER TABLE supplier_yield_records ADD CONSTRAINT fk_supplier_yield_records_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_yield_records_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_yield_records ADD CONSTRAINT fk_supplier_yield_records_bulk
    FOREIGN KEY (bulk_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_yield_records_bulk: %', SQLERRM; END $$;

-- supplier_shortages
DO $$ BEGIN
  ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_grn
    FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_shortages_grn: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_shortages_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_shortages ADD CONSTRAINT fk_supplier_shortages_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_shortages_product: %', SQLERRM; END $$;

-- supplier_returns
DO $$ BEGIN
  ALTER TABLE supplier_returns ADD CONSTRAINT fk_supplier_returns_grn
    FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_returns_grn: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_returns ADD CONSTRAINT fk_supplier_returns_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_returns_supplier: %', SQLERRM; END $$;

-- supplier_return_lines
DO $$ BEGIN
  ALTER TABLE supplier_return_lines ADD CONSTRAINT fk_supplier_return_lines_return
    FOREIGN KEY (return_id) REFERENCES supplier_returns(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_return_lines_return: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE supplier_return_lines ADD CONSTRAINT fk_supplier_return_lines_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_supplier_return_lines_product: %', SQLERRM; END $$;

-- purchase_orders
DO $$ BEGIN
  ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_purchase_orders_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_orders ADD CONSTRAINT fk_purchase_orders_location
    FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_purchase_orders_location: %', SQLERRM; END $$;

-- purchase_order_lines
DO $$ BEGIN
  ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_po
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pol_po: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pol_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_order_lines ADD CONSTRAINT fk_pol_supplier_product
    FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pol_supplier_product: %', SQLERRM; END $$;

-- goods_received_notes
DO $$ BEGIN
  ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_po
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_po: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE goods_received_notes ADD CONSTRAINT fk_grn_location
    FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_location: %', SQLERRM; END $$;

-- grn_lines
DO $$ BEGIN
  ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_grn
    FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_lines_grn: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_po_line
    FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_lines_po_line: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE grn_lines ADD CONSTRAINT fk_grn_lines_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_grn_lines_product: %', SQLERRM; END $$;

-- purchase_invoices
DO $$ BEGIN
  ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pi_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_po
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pi_po: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_invoices ADD CONSTRAINT fk_pi_grn
    FOREIGN KEY (grn_id) REFERENCES goods_received_notes(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pi_grn: %', SQLERRM; END $$;

-- purchase_invoice_lines
DO $$ BEGIN
  ALTER TABLE purchase_invoice_lines ADD CONSTRAINT fk_pil_invoice
    FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pil_invoice: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE purchase_invoice_lines ADD CONSTRAINT fk_pil_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pil_product: %', SQLERRM; END $$;

-- product_purchase_uoms
DO $$ BEGIN
  ALTER TABLE product_purchase_uoms ADD CONSTRAINT fk_ppu_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ppu_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE product_purchase_uoms ADD CONSTRAINT fk_ppu_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ppu_supplier: %', SQLERRM; END $$;

-- sales_order_lines
DO $$ BEGIN
  ALTER TABLE sales_order_lines ADD CONSTRAINT fk_sol_sales_order
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_sol_sales_order: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE sales_order_lines ADD CONSTRAINT fk_sol_product
    FOREIGN KEY (our_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_sol_product: %', SQLERRM; END $$;

-- decomposed_lines
DO $$ BEGIN
  ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_sales_order
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_dl_sales_order: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_sales_order_line
    FOREIGN KEY (sales_order_line_id) REFERENCES sales_order_lines(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_dl_sales_order_line: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE decomposed_lines ADD CONSTRAINT fk_dl_meal_product
    FOREIGN KEY (meal_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_dl_meal_product: %', SQLERRM; END $$;

-- production_runs (self-ref)
DO $$ BEGIN
  ALTER TABLE production_runs ADD CONSTRAINT fk_production_runs_parent
    FOREIGN KEY (parent_run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_production_runs_parent: %', SQLERRM; END $$;

-- production_run_lines
DO $$ BEGIN
  ALTER TABLE production_run_lines ADD CONSTRAINT fk_prl_run
    FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_prl_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_run_lines ADD CONSTRAINT fk_prl_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_prl_product: %', SQLERRM; END $$;

-- pick_lists
DO $$ BEGIN
  ALTER TABLE pick_lists ADD CONSTRAINT fk_pick_lists_run
    FOREIGN KEY (production_run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pick_lists_run: %', SQLERRM; END $$;

-- pick_lines
DO $$ BEGIN
  ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_list
    FOREIGN KEY (pick_list_id) REFERENCES pick_lists(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pick_lines_list: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pick_lines_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE pick_lines ADD CONSTRAINT fk_pick_lines_location
    FOREIGN KEY (from_location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pick_lines_location: %', SQLERRM; END $$;

-- production_tasks
DO $$ BEGIN
  ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_run
    FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pt_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_line
    FOREIGN KEY (line_id) REFERENCES production_run_lines(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pt_line: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pt_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_equipment
    FOREIGN KEY (equipment_id) REFERENCES equipment(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pt_equipment: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_tasks ADD CONSTRAINT fk_pt_team_member
    FOREIGN KEY (assigned_to) REFERENCES team_members(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pt_team_member: %', SQLERRM; END $$;

-- task_consumptions
DO $$ BEGIN
  ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_task
    FOREIGN KEY (task_id) REFERENCES production_tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_tc_task: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_run
    FOREIGN KEY (run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_tc_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_bom_component
    FOREIGN KEY (bom_component_id) REFERENCES bom_components(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_tc_bom_component: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_product
    FOREIGN KEY (input_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_tc_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE task_consumptions ADD CONSTRAINT fk_tc_wip_batch
    FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_tc_wip_batch: %', SQLERRM; END $$;

-- cooking_runs
DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_parent
    FOREIGN KEY (parent_run_id) REFERENCES cooking_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_parent: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_bulk_product
    FOREIGN KEY (bulk_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_bulk_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_cook_bom
    FOREIGN KEY (cook_bom_id) REFERENCES boms(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_cook_bom: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_supplier: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_raw_product
    FOREIGN KEY (raw_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_raw_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_assigned_staff
    FOREIGN KEY (assigned_staff_id) REFERENCES team_members(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_assigned_staff: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_production_manager
    FOREIGN KEY (production_manager_id) REFERENCES team_members(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_production_manager: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE cooking_runs ADD CONSTRAINT fk_cr_production_run
    FOREIGN KEY (production_run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_cr_production_run: %', SQLERRM; END $$;

-- wip_batches
DO $$ BEGIN
  ALTER TABLE wip_batches ADD CONSTRAINT fk_wb_bulk_product
    FOREIGN KEY (bulk_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wb_bulk_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE wip_batches ADD CONSTRAINT fk_wb_cooking_run
    FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wb_cooking_run: %', SQLERRM; END $$;

-- yield_records
DO $$ BEGIN
  ALTER TABLE yield_records ADD CONSTRAINT fk_yr_cooking_run
    FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_yr_cooking_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE yield_records ADD CONSTRAINT fk_yr_production_run
    FOREIGN KEY (production_run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_yr_production_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE yield_records ADD CONSTRAINT fk_yr_task
    FOREIGN KEY (task_id) REFERENCES production_tasks(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_yr_task: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE yield_records ADD CONSTRAINT fk_yr_bulk_product
    FOREIGN KEY (bulk_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_yr_bulk_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE yield_records ADD CONSTRAINT fk_yr_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_yr_supplier: %', SQLERRM; END $$;

-- stock_on_hand
DO $$ BEGIN
  ALTER TABLE stock_on_hand ADD CONSTRAINT fk_soh_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_soh_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE stock_on_hand ADD CONSTRAINT fk_soh_location
    FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_soh_location: %', SQLERRM; END $$;

-- stock_movements
DO $$ BEGIN
  ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_sm_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_from_location
    FOREIGN KEY (from_location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_sm_from_location: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE stock_movements ADD CONSTRAINT fk_sm_to_location
    FOREIGN KEY (to_location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_sm_to_location: %', SQLERRM; END $$;

-- production_task_logs
DO $$ BEGIN
  ALTER TABLE production_task_logs ADD CONSTRAINT fk_ptl_task
    FOREIGN KEY (task_id) REFERENCES production_tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ptl_task: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE production_task_logs ADD CONSTRAINT fk_ptl_run
    FOREIGN KEY (run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ptl_run: %', SQLERRM; END $$;

-- production_wastage_events
DO $$ BEGIN
  ALTER TABLE production_wastage_events ADD CONSTRAINT fk_pwe_cooking_run
    FOREIGN KEY (cooking_run_id) REFERENCES cooking_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_pwe_cooking_run: %', SQLERRM; END $$;

-- portioning_runs
DO $$ BEGIN
  ALTER TABLE portioning_runs ADD CONSTRAINT fk_por_production_run
    FOREIGN KEY (production_run_id) REFERENCES production_runs(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_por_production_run: %', SQLERRM; END $$;

-- portioning_run_lines
DO $$ BEGIN
  ALTER TABLE portioning_run_lines ADD CONSTRAINT fk_porl_portioning_run
    FOREIGN KEY (portioning_run_id) REFERENCES portioning_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_porl_portioning_run: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE portioning_run_lines ADD CONSTRAINT fk_porl_bulk_product
    FOREIGN KEY (bulk_product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_porl_bulk_product: %', SQLERRM; END $$;

-- wip_quality_checks
DO $$ BEGIN
  ALTER TABLE wip_quality_checks ADD CONSTRAINT fk_wqc_wip_batch
    FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wqc_wip_batch: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE wip_quality_checks ADD CONSTRAINT fk_wqc_qc_session
    FOREIGN KEY (qc_session_id) REFERENCES quality_check_sessions(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wqc_qc_session: %', SQLERRM; END $$;

-- rest_time_override_logs
DO $$ BEGIN
  ALTER TABLE rest_time_override_logs ADD CONSTRAINT fk_rtol_wip_batch
    FOREIGN KEY (wip_batch_id) REFERENCES wip_batches(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_rtol_wip_batch: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE rest_time_override_logs ADD CONSTRAINT fk_rtol_qc_session
    FOREIGN KEY (qc_session_id) REFERENCES quality_check_sessions(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_rtol_qc_session: %', SQLERRM; END $$;

-- stock_write_offs
DO $$ BEGIN
  ALTER TABLE stock_write_offs ADD CONSTRAINT fk_swo_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_swo_product: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE stock_write_offs ADD CONSTRAINT fk_swo_stock_movement
    FOREIGN KEY (stock_movement_id) REFERENCES stock_movements(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_swo_stock_movement: %', SQLERRM; END $$;

-- new_stock_takes
DO $$ BEGIN
  ALTER TABLE new_stock_takes ADD CONSTRAINT fk_nst_location
    FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_nst_location: %', SQLERRM; END $$;

-- stock_take_lines
DO $$ BEGIN
  ALTER TABLE stock_take_lines ADD CONSTRAINT fk_stl_stocktake
    FOREIGN KEY (stocktake_id) REFERENCES new_stock_takes(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_stl_stocktake: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE stock_take_lines ADD CONSTRAINT fk_stl_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_stl_product: %', SQLERRM; END $$;

-- wastage_lines
DO $$ BEGIN
  ALTER TABLE wastage_lines ADD CONSTRAINT fk_wl_wastage_log
    FOREIGN KEY (wastage_log_id) REFERENCES wastage_logs(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wl_wastage_log: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE wastage_lines ADD CONSTRAINT fk_wl_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_wl_product: %', SQLERRM; END $$;

-- equipment
DO $$ BEGIN
  ALTER TABLE equipment ADD CONSTRAINT fk_equipment_location
    FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_equipment_location: %', SQLERRM; END $$;

-- equipment_capacities
DO $$ BEGIN
  ALTER TABLE equipment_capacities ADD CONSTRAINT fk_ec_equipment
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ec_equipment: %', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE equipment_capacities ADD CONSTRAINT fk_ec_product
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'fk_ec_product: %', SQLERRM; END $$;
