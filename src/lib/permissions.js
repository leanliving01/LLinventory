/**
 * Centralised permission keys and role defaults.
 * Each key maps to a human-readable label.
 * Role defaults define the starting permissions when a role is selected.
 */

export const PERMISSION_KEYS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'catalog_view', label: 'Catalog (view)' },
  { key: 'catalog_edit', label: 'Catalog (edit)' },
  { key: 'recipes_view', label: 'Recipes (view)' },
  { key: 'recipes_edit', label: 'Recipes (edit)' },
  { key: 'production_planning', label: 'Production Planning' },
  { key: 'production_runs', label: 'Production Runs' },
  { key: 'kitchen_tablet', label: 'Kitchen Tablet' },
  { key: 'pick_lists', label: 'Pick Lists' },
  { key: 'wastage', label: 'Wastage' },
  { key: 'stock_take', label: 'Stock Take' },
  { key: 'stock_transfers', label: 'Stock Transfers' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'purchase_orders', label: 'Purchase Orders' },
  { key: 'sales_orders', label: 'Sales / Orders' },
  { key: 'customers', label: 'Customers' },
  { key: 'reports', label: 'Reports' },
  { key: 'cost_data', label: 'Cost Data (visible)' },
  { key: 'settings', label: 'Settings' },
  { key: 'user_management', label: 'User Management' },
];

export const ROLE_DEFAULTS = {
  admin:            { dashboard: true, catalog_view: true, catalog_edit: true, recipes_view: true, recipes_edit: true, production_planning: true, production_runs: true, kitchen_tablet: true, pick_lists: true, wastage: true, stock_take: true, stock_transfers: true, receiving: true, purchase_orders: true, sales_orders: true, customers: true, reports: true, cost_data: true, settings: true, user_management: true },
  ops_manager:      { dashboard: true, catalog_view: true, catalog_edit: true, recipes_view: true, recipes_edit: true, production_planning: true, production_runs: true, kitchen_tablet: true, pick_lists: true, wastage: true, stock_take: true, stock_transfers: true, receiving: true, purchase_orders: true, sales_orders: true, customers: true, reports: true, cost_data: true, settings: false, user_management: false },
  kitchen_manager:  { dashboard: true, catalog_view: true, catalog_edit: false, recipes_view: true, recipes_edit: true, production_planning: true, production_runs: true, kitchen_tablet: true, pick_lists: true, wastage: true, stock_take: false, stock_transfers: false, receiving: false, purchase_orders: false, sales_orders: false, customers: false, reports: true, cost_data: false, settings: false, user_management: false },
  kitchen:          { dashboard: false, catalog_view: false, catalog_edit: false, recipes_view: true, recipes_edit: false, production_planning: false, production_runs: true, kitchen_tablet: true, pick_lists: false, wastage: true, stock_take: false, stock_transfers: false, receiving: false, purchase_orders: false, sales_orders: false, customers: false, reports: false, cost_data: false, settings: false, user_management: false },
  stock_controller: { dashboard: true, catalog_view: true, catalog_edit: false, recipes_view: false, recipes_edit: false, production_planning: false, production_runs: false, kitchen_tablet: false, pick_lists: true, wastage: false, stock_take: true, stock_transfers: true, receiving: true, purchase_orders: true, sales_orders: false, customers: false, reports: true, cost_data: false, settings: false, user_management: false },
  picker_packer:    { dashboard: false, catalog_view: false, catalog_edit: false, recipes_view: false, recipes_edit: false, production_planning: false, production_runs: false, kitchen_tablet: false, pick_lists: true, wastage: false, stock_take: false, stock_transfers: false, receiving: false, purchase_orders: false, sales_orders: true, customers: false, reports: false, cost_data: false, settings: false, user_management: false },
  floor_operator:   { dashboard: false, catalog_view: false, catalog_edit: false, recipes_view: true, recipes_edit: false, production_planning: false, production_runs: true, kitchen_tablet: true, pick_lists: true, wastage: true, stock_take: true, stock_transfers: true, receiving: true, purchase_orders: false, sales_orders: false, customers: false, reports: false, cost_data: false, settings: false, user_management: false },
  viewer:           { dashboard: true, catalog_view: true, catalog_edit: false, recipes_view: true, recipes_edit: false, production_planning: true, production_runs: true, kitchen_tablet: false, pick_lists: false, wastage: true, stock_take: false, stock_transfers: false, receiving: false, purchase_orders: true, sales_orders: true, customers: true, reports: true, cost_data: false, settings: false, user_management: false },
};

/** Built-in role keys */
export const BUILT_IN_ROLES = Object.keys(ROLE_DEFAULTS);

/** Parse stored permissions JSON, falling back to role defaults.
 *  Supports custom roles — if role key isn't in ROLE_DEFAULTS, uses viewer defaults
 *  but still applies any stored permission overrides. */
export function getUserPermissions(user, customRoles = []) {
  const roleKey = user.role || 'viewer';
  // Check built-in first, then custom roles
  let defaults = ROLE_DEFAULTS[roleKey];
  if (!defaults) {
    const custom = customRoles.find(r => r.key === roleKey);
    if (custom?.permissions) {
      defaults = custom.permissions;
    } else {
      defaults = ROLE_DEFAULTS.viewer;
    }
  }
  if (!user.permissions) return { ...defaults };
  try {
    const overrides = JSON.parse(user.permissions);
    return { ...defaults, ...overrides };
  } catch {
    return { ...defaults };
  }
}