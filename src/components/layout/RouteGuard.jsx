import React from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { ShieldAlert } from 'lucide-react';

/**
 * Maps route paths (and path prefixes) to required permission keys.
 * Routes not listed here are accessible to everyone.
 */
const ROUTE_PERMISSIONS = {
  '/': 'dashboard',
  '/catalog': 'catalog_view',
  '/customers': 'customers',
  '/recipes': 'recipes_view',
  '/suppliers': 'purchase_orders',
  '/purchasing': 'purchase_orders',
  '/sales': 'sales_orders',
  '/production': 'production_planning',
  '/production/runs': 'production_runs',
  '/production/run': 'production_runs',
  '/production/plan-review': 'production_planning',
  '/stock/receive': 'receiving',
  '/stock/transfer': 'stock_transfers',
  '/stock/stock-take': 'stock_take',
  '/stock/wastage': 'wastage',
  '/shopify': 'settings',
  '/reports': 'reports',
  '/equipment': 'settings',
  '/settings': 'settings',
  '/kitchen': 'kitchen_tablet',
  '/floor/tasks': 'kitchen_tablet',
  '/floor/pick': 'pick_lists',
  '/floor/pack': 'pick_lists',
  '/floor/stock-take': 'stock_take',
  '/floor/transfer': 'stock_transfers',
  '/floor/receive': 'receiving',
  '/floor/scan': 'pick_lists',
};

function getRequiredPermission(pathname) {
  // Exact match first
  if (ROUTE_PERMISSIONS[pathname]) return ROUTE_PERMISSIONS[pathname];
  // Try prefix match (longest first)
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

  if (!user) return children;
  if (user.role === 'admin') return children;

  const requiredPerm = getRequiredPermission(location.pathname);
  if (!requiredPerm) return children;

  const perms = getUserPermissions(user);
  if (perms[requiredPerm]) return children;

  // Blocked — show access denied
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