/**
 * Centralised permission keys and role defaults.
 *
 * GRANULARITY MODEL (inspired by Cin7 Core):
 *   Module-level   →  e.g. dashboard_view, po_view
 *   Action-level   →  e.g. po_create, po_approve, runs_start_complete
 *   Sensitivity     →  e.g. cost_data (hides ZAR costs everywhere)
 *
 * When adding a new feature or page:
 *   1. Add a key here with a clear label
 *   2. Set the default for every built-in role
 *   3. Update RouteGuard if it's a new route
 *   4. Update Sidebar PATH_PERMISSION_MAP
 *   5. Add conditional checks in the UI (e.g. hide "Create PO" button)
 */

export const PERMISSION_GROUPS = [
  {
    group: 'Dashboard',
    keys: [
      { key: 'dashboard_view',       label: 'View Dashboard' },
      { key: 'dashboard_kpis',       label: 'See KPI Cards' },
      { key: 'dashboard_revenue',    label: 'See Revenue / Sales Charts' },
      { key: 'dashboard_production', label: 'See Production Charts' },
      { key: 'dashboard_costs',      label: 'See Cost & PO Data' },
      { key: 'dashboard_shortages',  label: 'See Low Stock / Shortages' },
    ],
  },
  {
    group: 'Catalog & Recipes',
    keys: [
      { key: 'catalog_view',  label: 'View Products' },
      { key: 'catalog_edit',  label: 'Edit Products' },
      { key: 'recipes_view',  label: 'View Recipes' },
      { key: 'recipes_edit',  label: 'Edit Recipes' },
    ],
  },
  {
    group: 'Production',
    keys: [
      { key: 'planning_view',         label: 'View Production Plan' },
      { key: 'planning_create',       label: 'Create / Edit Plans' },
      { key: 'runs_view',             label: 'View Production Runs' },
      { key: 'runs_create',           label: 'Create Runs' },
      { key: 'runs_start_complete',   label: 'Start / Complete Runs' },
      { key: 'runs_approve_complete',  label: 'Approve Run Completion (Manager PIN)' },
      { key: 'team_management',        label: 'Manage Kitchen Team Members' },
      { key: 'kitchen_tablet',        label: 'Kitchen / Floor Tasks' },
      { key: 'pick_lists',            label: 'Pick Lists & Packing' },
      { key: 'yield_tracker',         label: 'Yield Tracker / Shortages' },
      { key: 'cooking_runs_view',     label: 'View Cooking Runs' },
      { key: 'cooking_runs_create',   label: 'Create / Execute Cooking Runs' },
      { key: 'cooking_runs_release',  label: 'Release Cooking Runs from WIP Planning' },
      { key: 'wip_view',              label: 'View Bulk Cooked Inventory' },
      { key: 'wip_manage',            label: 'Quality Checks & Write-offs' },
      { key: 'wip_qc_override',       label: 'Override Rest Time (PIN required)' },
      { key: 'yield_review',          label: 'Review & Approve Yield Records' },
      { key: 'supplier_yield_view',   label: 'View Supplier Yield Data' },
      { key: 'wip_planning',          label: 'WIP Planning & Morning QC' },
      { key: 'wastage_review',        label: 'Review Wastage Events' },
    ],
  },
  {
    group: 'Inventory',
    keys: [
      { key: 'stocktake_view',    label: 'View Stock Takes' },
      { key: 'stocktake_create',  label: 'Create / Approve Stock Takes' },
      { key: 'stock_transfers',   label: 'Stock Transfers' },
      { key: 'receiving',         label: 'Receive Stock' },
      { key: 'wastage',           label: 'Wastage' },
      { key: 'par_levels',        label: 'Par Levels' },
      { key: 'movements_view',    label: 'View Stock Movements' },
      { key: 'inventory_overview', label: 'Inventory Overview' },
      { key: 'inventory_recalc_committed', label: 'Recalculate Committed Stock' },
      { key: 'stock_writeoff_view', label: 'View Stock Write-Offs' },
      { key: 'stock_writeoff_create', label: 'Create Stock Write-Offs' },
    ],
  },
  {
    group: 'Purchasing',
    keys: [
      { key: 'po_view',                label: 'View Purchase Orders' },
      { key: 'po_create',              label: 'Create / Edit POs' },
      { key: 'po_approve',             label: 'Approve POs (high value)' },
      { key: 'grn_create',             label: 'Receive Goods (GRN)' },
      { key: 'blind_receipt_create',   label: 'Create Blind Receipts' },
      { key: 'product_review',         label: 'Review Unmatched Products' },
      { key: 'product_create_from_queue', label: 'Create Products from Queue' },
      { key: 'returns_process',        label: 'Process Returns' },
      { key: 'supplier_product_edit',  label: 'Edit Supplier Product Catalog' },
      { key: 'xero_invoice_sync',      label: 'Sync Invoices from Xero' },
      { key: 'purchasing_dashboard',   label: 'Purchasing Dashboard' },
      { key: 'shortages_view',         label: 'View Open Shortages' },
      { key: 'returns_view',           label: 'View Pending Returns' },
      { key: 'suppliers',              label: 'Manage Suppliers' },
      { key: 'supplier_scorecard',    label: 'Supplier Scorecard' },
      { key: 'price_variance_view',   label: 'View Price Variance Dashboard' },
      { key: 'three_way_match_view', label: 'Three-Way Matching (PO/GRN/Invoice)' },
    ],
  },
  {
    group: 'Sales & Customers',
    keys: [
      { key: 'sales_view',    label: 'View Sales / Orders' },
      { key: 'sales_fulfill', label: 'Fulfill Orders' },
      { key: 'customers',     label: 'Customers' },
    ],
  },
  {
    group: 'Reports & Data',
    keys: [
      { key: 'reports_view',  label: 'View Reports' },
      { key: 'reports_costs', label: 'See Cost Data in Reports' },
      { key: 'reports_team',  label: 'Team Performance' },
      { key: 'forecasting',   label: 'Trend Forecasting' },
      { key: 'food_cost_view', label: 'View Food Cost Dashboard' },
      { key: 'food_cost_run',  label: 'Run Cost Rollup' },
    ],
  },
  {
    group: 'System',
    keys: [
      { key: 'equipment',       label: 'Equipment Manager' },
      { key: 'shopify_sync',    label: 'Shopify Sync' },
      { key: 'settings',        label: 'Settings' },
      { key: 'user_management', label: 'User Management' },
      { key: 'activity_log_view', label: 'View Activity Log' },
    ],
  },
];

/** Flat list for iteration (backwards-compatible) */
export const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.keys);

/** All permission key strings */
const ALL_KEYS = PERMISSION_KEYS.map(pk => pk.key);

/** Helper: build a permissions object from a list of enabled keys */
const p = (...enabled) => {
  const obj = {};
  ALL_KEYS.forEach(k => { obj[k] = enabled.includes(k); });
  return obj;
};

const ALL = ALL_KEYS; // shorthand for admin

export const ROLE_DEFAULTS = {
  admin: p(...ALL),

  ops_manager: p(
    'dashboard_view', 'dashboard_kpis', 'dashboard_revenue', 'dashboard_production', 'dashboard_costs', 'dashboard_shortages',
    'catalog_view', 'catalog_edit', 'recipes_view', 'recipes_edit',
    'planning_view', 'planning_create', 'runs_view', 'runs_create', 'runs_start_complete', 'runs_approve_complete', 'team_management', 'kitchen_tablet', 'pick_lists', 'yield_tracker',
    'cooking_runs_view', 'cooking_runs_create', 'cooking_runs_release', 'wip_view', 'wip_manage', 'wip_qc_override', 'yield_review', 'supplier_yield_view', 'wip_planning', 'wastage_review',
    'stocktake_view', 'stocktake_create', 'stock_transfers', 'receiving', 'wastage', 'par_levels', 'movements_view', 'inventory_overview', 'inventory_recalc_committed', 'stock_writeoff_view', 'stock_writeoff_create',
    'po_view', 'po_create', 'po_approve', 'grn_create', 'blind_receipt_create', 'product_review', 'product_create_from_queue', 'returns_process', 'supplier_product_edit', 'xero_invoice_sync', 'purchasing_dashboard', 'shortages_view', 'returns_view', 'suppliers', 'price_variance_view', 'three_way_match_view',
    'sales_view', 'sales_fulfill', 'customers',
    'reports_view', 'reports_costs', 'reports_team', 'forecasting', 'food_cost_view', 'food_cost_run',
    'equipment', 'shopify_sync', 'supplier_scorecard', 'activity_log_view',
  ),

  kitchen_manager: p(
    'dashboard_view', 'dashboard_kpis', 'dashboard_production', 'dashboard_shortages',
    'catalog_view', 'recipes_view', 'recipes_edit',
    'planning_view', 'planning_create', 'runs_view', 'runs_create', 'runs_start_complete', 'runs_approve_complete', 'team_management', 'kitchen_tablet', 'pick_lists', 'yield_tracker',
    'cooking_runs_view', 'cooking_runs_create', 'cooking_runs_release', 'wip_view', 'wip_manage', 'wip_qc_override', 'yield_review', 'supplier_yield_view', 'wip_planning', 'wastage_review',
    'wastage', 'par_levels', 'inventory_overview', 'stock_writeoff_view', 'stock_writeoff_create',
    'po_view', 'grn_create', 'purchasing_dashboard',
    'reports_view', 'reports_team', 'food_cost_view',
  ),

  kitchen: p(
    'recipes_view',
    'runs_view', 'kitchen_tablet', 'yield_tracker',
    'cooking_runs_view', 'cooking_runs_create', 'wip_view', 'wip_planning',
    'wastage',
  ),

  stock_controller: p(
    'dashboard_view', 'dashboard_kpis', 'dashboard_shortages',
    'catalog_view',
    'runs_view', 'pick_lists',
    'stocktake_view', 'stocktake_create', 'stock_transfers', 'receiving', 'movements_view', 'inventory_overview', 'inventory_recalc_committed', 'stock_writeoff_view', 'stock_writeoff_create',
    'po_view', 'po_create', 'grn_create', 'blind_receipt_create', 'product_review', 'returns_process', 'purchasing_dashboard', 'shortages_view', 'returns_view', 'suppliers', 'price_variance_view', 'three_way_match_view', 'supplier_scorecard',
    'reports_view', 'food_cost_view',
    'par_levels',
  ),

  picker_packer: p(
    'pick_lists',
    'sales_view',
  ),

  floor_operator: p(
    'recipes_view',
    'runs_view', 'kitchen_tablet', 'pick_lists', 'yield_tracker',
    'cooking_runs_view', 'cooking_runs_create', 'wip_view', 'wip_planning',
    'stocktake_view', 'stocktake_create', 'stock_transfers', 'receiving',
    'wastage', 'inventory_overview',
  ),

  viewer: p(
    'dashboard_view', 'dashboard_kpis', 'dashboard_production', 'dashboard_shortages',
    'catalog_view', 'recipes_view',
    'planning_view', 'runs_view',
    'stocktake_view', 'inventory_overview',
    'po_view', 'purchasing_dashboard', 'shortages_view', 'returns_view', 'three_way_match_view',
    'sales_view', 'customers',
    'reports_view', 'food_cost_view',
    'par_levels',
  ),
};

/** Built-in role keys */
export const BUILT_IN_ROLES = Object.keys(ROLE_DEFAULTS);

/**
 * Parse stored permissions JSON, falling back to role defaults.
 * Supports custom roles — if role key isn't in ROLE_DEFAULTS, uses viewer defaults
 * but still applies any stored permission overrides.
 *
 * MIGRATION: old keys (e.g. 'dashboard', 'production_planning') are mapped forward
 * to new granular keys so existing user overrides still work.
 */
const LEGACY_MAP = {
  dashboard:            ['dashboard_view', 'dashboard_kpis', 'dashboard_production', 'dashboard_shortages'],
  production_planning:  ['planning_view', 'planning_create'],
  production_runs:      ['runs_view', 'runs_create', 'runs_start_complete'],
  stock_take:           ['stocktake_view', 'stocktake_create'],
  purchase_orders:      ['po_view', 'po_create', 'po_approve', 'grn_create', 'suppliers'],
  po_receive:           ['grn_create'],
  sales_orders:         ['sales_view', 'sales_fulfill'],
  reports:              ['reports_view', 'reports_costs', 'reports_team', 'forecasting'],
  cost_data:            ['dashboard_costs', 'reports_costs'],
  portioning_view:      ['wip_planning'],
  portioning_create:    ['wip_planning'],
};

function migrateLegacyOverrides(overrides) {
  const migrated = { ...overrides };
  for (const [oldKey, newKeys] of Object.entries(LEGACY_MAP)) {
    if (oldKey in migrated) {
      const val = migrated[oldKey];
      for (const nk of newKeys) {
        if (!(nk in migrated)) migrated[nk] = val;
      }
      delete migrated[oldKey];
    }
  }
  return migrated;
}

export function getUserPermissions(user, customRoles = []) {
  const roleKey = user.role || 'viewer';
  let defaults = ROLE_DEFAULTS[roleKey];
  if (!defaults) {
    const custom = customRoles.find(r => r.key === roleKey);
    if (custom?.permissions) {
      // Custom role permissions may use old keys — fill missing new keys with false
      const filled = {};
      ALL_KEYS.forEach(k => { filled[k] = false; });
      Object.assign(filled, custom.permissions);
      defaults = filled;
    } else {
      defaults = ROLE_DEFAULTS.viewer;
    }
  }
  if (!user.permissions) return { ...defaults };
  try {
    const raw = JSON.parse(user.permissions);
    const overrides = migrateLegacyOverrides(raw);
    return { ...defaults, ...overrides };
  } catch {
    return { ...defaults };
  }
}