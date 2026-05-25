import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import {
  UtensilsCrossed,
  PackageCheck,
  ClipboardCheck,
  ArrowLeftRight,
  Truck,
  ScanBarcode,
  AlertTriangle,
  ChevronRight,
  Box,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULES = [
  {
    path: '/floor/tasks',
    label: 'Production Tasks',
    description: 'Cook, prep & portion tasks',
    icon: UtensilsCrossed,
    permission: 'kitchen_tablet',
    iconColor: 'bg-amber-500',
    accent: 'border-l-amber-500',
  },
  {
    path: '/floor/pick',
    label: 'Production Pick',
    description: 'Pull ingredients for a run',
    icon: PackageCheck,
    permission: 'pick_lists',
    iconColor: 'bg-blue-500',
    accent: 'border-l-blue-500',
  },
  {
    path: '/floor/pack',
    label: 'Order Packing',
    description: 'Scan & pack customer orders',
    icon: Box,
    permission: 'pick_lists',
    iconColor: 'bg-indigo-500',
    accent: 'border-l-indigo-500',
  },
  {
    path: '/floor/shortages',
    label: 'Yield Tracker',
    description: 'Shortages & surplus plating',
    icon: AlertTriangle,
    permission: 'yield_tracker',
    iconColor: 'bg-red-500',
    accent: 'border-l-red-500',
  },
  {
    path: '/floor/stock-take',
    label: 'Stock Count',
    description: 'Count stock by zone',
    icon: ClipboardCheck,
    permission: 'stocktake_view',
    iconColor: 'bg-green-500',
    accent: 'border-l-green-500',
  },
  {
    path: '/floor/transfer',
    label: 'Transfer Stock',
    description: 'Move stock between zones',
    icon: ArrowLeftRight,
    permission: 'stock_transfers',
    iconColor: 'bg-purple-500',
    accent: 'border-l-purple-500',
  },
  {
    path: '/floor/receive',
    label: 'Receive Stock',
    description: 'Receive against PO',
    icon: Truck,
    permission: 'receiving',
    iconColor: 'bg-orange-500',
    accent: 'border-l-orange-500',
  },
  {
    path: '/floor/scan',
    label: 'Quick Scan',
    description: 'Scan barcode to look up item',
    icon: ScanBarcode,
    permission: 'catalog_view',
    iconColor: 'bg-slate-600',
    accent: 'border-l-slate-500',
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function FloorHome() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const isAdmin = ['admin', 'ops_manager'].includes(user?.role);
  const firstName = user?.full_name?.split(' ')[0] || null;

  const visibleModules = MODULES.filter(m => {
    if (!m.permission) return true;
    return isAdmin || perms[m.permission];
  });

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          {getGreeting()}{firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">What are you working on today?</p>
      </div>

      {/* Module grid — 2 columns, big tap targets */}
      <div className="grid grid-cols-2 gap-3">
        {visibleModules.map(mod => (
          <Link
            key={mod.path}
            to={mod.path}
            className={cn(
              "bg-card border border-border border-l-4 rounded-2xl p-5 flex flex-col items-start gap-3",
              "shadow-sm active:scale-[0.97] transition-transform",
              mod.accent,
            )}
          >
            <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center text-white shrink-0", mod.iconColor)}>
              <mod.icon className="w-7 h-7" />
            </div>
            <div className="flex-1 w-full">
              <p className="font-bold text-base leading-tight">{mod.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 self-end" />
          </Link>
        ))}
      </div>
    </div>
  );
}
