import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, UtensilsCrossed, PackageCheck, ClipboardCheck, ArrowLeftRight, Truck, Box, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

const NAV_ITEMS = [
  { path: '/floor', icon: Home, label: 'Home', permission: null },
  { path: '/floor/tasks', icon: UtensilsCrossed, label: 'Tasks', permission: 'kitchen_tablet' },
  { path: '/floor/pick', icon: PackageCheck, label: 'Pick', permission: 'pick_lists' },
  { path: '/floor/pack', icon: Box, label: 'Pack', permission: 'pick_lists' },
  { path: '/floor/shortages', icon: AlertTriangle, label: 'Yields', permission: 'yield_tracker' },
  { path: '/floor/stock-take', icon: ClipboardCheck, label: 'Stock', permission: 'stocktake_view' },
  { path: '/floor/transfer', icon: ArrowLeftRight, label: 'Transfer', permission: 'stock_transfers' },
  { path: '/floor/receive', icon: Truck, label: 'Receive', permission: 'receiving' },
];

export default function FloorBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const isAdmin = ['admin', 'ops_manager'].includes(user?.role);

  const visibleItems = NAV_ITEMS.filter(item => {
    if (!item.permission) return true;
    return isAdmin || perms[item.permission];
  });

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 safe-area-pb">
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {visibleItems.map(item => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/floor' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center justify-center py-2 px-1 flex-1 min-h-[60px] transition-colors"
            >
              <div className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 transition-colors",
                isActive ? "bg-primary/10" : "active:bg-muted"
              )}>
                <item.icon className={cn(
                  "shrink-0",
                  isActive ? "w-6 h-6 text-primary" : "w-5 h-5 text-muted-foreground"
                )} />
                <span className={cn(
                  "text-[10px] font-medium leading-tight text-center",
                  isActive ? "text-primary font-semibold" : "text-muted-foreground"
                )}>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}