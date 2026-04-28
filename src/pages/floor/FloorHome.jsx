import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import {
  UtensilsCrossed,
  PackageCheck,
  ClipboardCheck,
  ArrowLeftRight,
  Truck,
  ScanBarcode,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULES = [
  {
    path: '/floor/tasks',
    label: 'Production Tasks',
    description: 'Cook, prep & portion tasks',
    icon: UtensilsCrossed,
    permission: 'kitchen_tablet',
    color: 'bg-amber-500',
  },
  {
    path: '/floor/pick',
    label: 'Pick & Pack',
    description: 'Pick orders, scan & pack',
    icon: PackageCheck,
    permission: 'pick_lists',
    color: 'bg-blue-500',
  },
  {
    path: '/floor/stock-take',
    label: 'Stock Count',
    description: 'Count stock by zone',
    icon: ClipboardCheck,
    permission: 'stock_take',
    color: 'bg-green-500',
  },
  {
    path: '/floor/transfer',
    label: 'Transfer Stock',
    description: 'Move stock between zones',
    icon: ArrowLeftRight,
    permission: 'stock_transfers',
    color: 'bg-purple-500',
  },
  {
    path: '/floor/receive',
    label: 'Receive Stock',
    description: 'Receive against PO',
    icon: Truck,
    permission: 'receiving',
    color: 'bg-orange-500',
  },
  {
    path: '/floor/scan',
    label: 'Quick Scan',
    description: 'Scan barcode to look up item',
    icon: ScanBarcode,
    permission: null,
    color: 'bg-slate-600',
  },
];

export default function FloorHome() {
  const { user } = useAuth();
  const perms = getUserPermissions(user || {});
  const isAdmin = ['admin', 'ops_manager'].includes(user?.role);

  const visibleModules = MODULES.filter(m => {
    if (!m.permission) return true;
    return isAdmin || perms[m.permission];
  });

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          Hey{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">What are you working on?</p>
      </div>

      {/* Module grid — 2 columns, big tap targets */}
      <div className="grid grid-cols-2 gap-3">
        {visibleModules.map(mod => (
          <Link
            key={mod.path}
            to={mod.path}
            className="bg-card border border-border rounded-2xl p-5 flex flex-col items-start gap-3 active:scale-[0.97] transition-transform"
          >
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white", mod.color)}>
              <mod.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-sm">{mod.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}