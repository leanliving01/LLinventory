import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { ShieldAlert } from 'lucide-react';

/**
 * Maps route paths (and path prefixes) to required permission keys.
 * Routes not listed here are accessible to everyone.
 * Uses the GRANULAR permission keys.
 */
const ROUTE_PERMISSIONS = {
  '/':                     'dashboard_view',
  '/catalog':              'catalog_view',
  '/customers':            'customers',
  '/recipes':              'recipes_view',
  '/suppliers':            'suppliers',
  '/purchasing/orders':    'po_view',
  '/purchasing/reorder':   'po_view',
  '/purchasing/settings':  'po_create',
  '/purchasing/supplier-products': 'supplier_product_edit',
  '/purchasing/grn': 'grn_create',
  '/purchasing/shortages': 'shortages_view',
  '/purchasing/returns':   'returns_view',
  '/purchasing/invoices':  'xero_invoice_sync',
  '/purchasing/review-queue': 'product_review',
  '/purchasing/price-variance': 'price_variance_view',
  '/purchasing/three-way-match': 'three_way_match_view',
  '/purchasing/dashboard': 'purchasing_dashboard',
  '/purchasing/scorecard': 'supplier_scorecard',
  '/purchasing/pack-bom':  'recipes_edit',
  '/sales':                'sales_view',
  '/production':           'planning_view',
  '/production/plan-review': 'planning_view',
  '/production/runs':      'runs_view',
  '/production/run':       'runs_view',
  '/stock/receive':        'receiving',
  '/stock/transfer':       'stock_transfers',
  '/stock/stock-take':     'stocktake_view',
  '/stock/wastage':        'wastage',
  '/stock/par-levels':     'par_levels',
  '/shopify':              'shopify_sync',
  '/reports':              'reports_view',
  '/reports/team':         'reports_team',
  '/reports/forecasting':  'forecasting',
  '/reports/food-cost':    'food_cost_view',
  '/equipment':            'equipment',
  '/settings':             'settings',
  '/kitchen':              'kitchen_tablet',
  '/floor/tasks':          'kitchen_tablet',
  '/floor/pick':           'pick_lists',
  '/floor/pack':           'pick_lists',
  '/floor/stock-take':     'stocktake_view',
  '/floor/transfer':       'stock_transfers',
  '/floor/receive':        'receiving',
  '/floor/scan':           'catalog_view',
  '/floor/shortages':      'yield_tracker',
  '/stock/movements':      'movements_view',
  '/stock/overview':       'inventory_overview',
  '/production/cooking':   'cooking_runs_view',
  '/production/wip':       'wip_view',
  '/production/portioning':'portioning_view',
  '/production/yield-review':'yield_review',
  '/production/supplier-yield':'supplier_yield_view',
  '/production/wip-planning':'wip_planning',
};

function getRequiredPermission(pathname) {
  if (ROUTE_PERMISSIONS[pathname]) return ROUTE_PERMISSIONS[pathname];
  const sorted = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (pathname.startsWith(prefix + '/') || pathname === prefix) {
      return ROUTE_PERMISSIONS[prefix];
    }
  }
  return null;
}

export default function RouteGuard({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const customRoles = useCustomRoles();

  if (!user) return children;
  if (user.role === 'admin') return children;

  const requiredPerm = getRequiredPermission(location.pathname);
  if (!requiredPerm) return children;

  const perms = getUserPermissions(user, customRoles);
  if (perms[requiredPerm]) return children;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldAlert className="w-8 h-8 text-destructive" />
      </div>
      <h1 className="text-xl font-bold mb-2">Access Denied</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        You don't have permission to view this page. Contact your admin if you believe this is an error.
      </p>
    </div>
  );
}