import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Warehouse, 
  Factory, 
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  UtensilsCrossed,
  Barcode,
  Gauge,
  Box,
  Truck,
  CookingPot,
  PlayCircle,
  Trash2,
  ArrowLeftRight,
  ArrowRightLeft,
  PackageCheck,
  Users,
  Receipt,
  AlertTriangle,
  Wrench,
  TrendingUp,
  Search,
  Bug
} from 'lucide-react';
import { cn } from '@/lib/utils';
import DarkModeToggle from './DarkModeToggle';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

/**
 * Maps each nav path to the permission key that controls access.
 * Paths not listed here are visible to everyone (e.g. /bugs).
 */
const PATH_PERMISSION_MAP = {
  '/': 'dashboard_view',
  '/catalog': 'catalog_view',
  '/customers': 'customers',
  '/recipes': 'recipes_view',
  '/suppliers': 'suppliers',
  '/purchasing/orders': 'po_view',
  '/purchasing/reorder': 'po_view',
  '/purchasing/settings': 'po_create',
  '/purchasing/supplier-products': 'supplier_product_edit',
  '/purchasing/grn': 'grn_create',
  '/purchasing/shortages': 'shortages_view',
  '/purchasing/returns': 'returns_view',
  '/purchasing/invoices': 'xero_invoice_sync',
  '/purchasing/review-queue': 'product_review',
  '/purchasing/price-variance': 'price_variance_view',
  '/purchasing/pack-bom': 'recipes_edit',
  '/stock/overview': 'inventory_overview',
  '/sales': 'sales_view',
  '/production': 'planning_view',
  '/production/runs': 'runs_view',
  '/production/plan-review': 'planning_view',
  '/stock/receive': 'receiving',
  '/stock/transfer': 'stock_transfers',
  '/stock/stock-take': 'stocktake_view',
  '/stock/wastage': 'wastage',
  '/stock/par-levels': 'par_levels',
  '/stock/movements': 'movements_view',
  '/shopify': 'shopify_sync',
  '/reports': 'reports_view',
  '/reports/team': 'reports_team',
  '/reports/forecasting': 'forecasting',
  '/equipment': 'equipment',
  '/floor/pick': 'pick_lists',
  '/floor/pack': 'pick_lists',
  '/floor/tasks': 'kitchen_tablet',
  '/floor/shortages': 'yield_tracker',
  '/production/cooking': 'cooking_runs_view',
  '/production/wip': 'wip_view',
  '/production/wip-planning': 'wip_planning',
  '/production/portioning': 'portioning_view',
  '/production/yield-review': 'yield_review',
  '/production/supplier-yield': 'supplier_yield_view',
  '/floor/stock-take': 'stocktake_view',
  '/floor/transfer': 'stock_transfers',
  '/floor/receive': 'receiving',
  '/floor/scan': 'catalog_view',
  '/settings': 'settings',
};

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Products', path: '/catalog', icon: Package },
  { label: 'Customers', path: '/customers', icon: Users },
  { label: 'Bill of Materials', path: '/recipes', icon: CookingPot },
  { 
    label: 'Purchasing', icon: Truck,
    children: [
      { label: 'Suppliers', path: '/suppliers', icon: Truck },
      { label: 'Purchase Orders', path: '/purchasing/orders', icon: Receipt },
      { label: 'Reorder Report', path: '/purchasing/reorder', icon: AlertTriangle },
      { label: 'Supplier Products', path: '/purchasing/supplier-products', icon: ArrowRightLeft },
      { label: 'Goods Received', path: '/purchasing/grn', icon: PackageCheck },
      { label: 'Shortages', path: '/purchasing/shortages', icon: AlertTriangle },
      { label: 'Returns', path: '/purchasing/returns', icon: ArrowLeftRight },
      { label: 'Invoices (Xero)', path: '/purchasing/invoices', icon: FileText },
      { label: 'Review Queue', path: '/purchasing/review-queue', icon: ClipboardCheck },
      { label: 'Price Variance', path: '/purchasing/price-variance', icon: TrendingUp },
    ]
  },
  { label: 'Sales', path: '/sales', icon: ShoppingCart },
  { 
    label: 'Production', icon: Factory,
    children: [
      { label: 'Production Plan', path: '/production', icon: Factory },
      { label: 'Production Runs', path: '/production/runs', icon: PlayCircle },
      { label: 'Cooking Runs', path: '/production/cooking', icon: CookingPot },
      { label: 'Bulk Cooked (WIP)', path: '/production/wip', icon: Package },
      { label: 'WIP Planning', path: '/production/wip-planning', icon: ClipboardCheck },
      { label: 'Portioning', path: '/production/portioning', icon: UtensilsCrossed },
      { label: 'Yield Review', path: '/production/yield-review', icon: Gauge },
      { label: 'Supplier Yield', path: '/production/supplier-yield', icon: TrendingUp },
    ]
  },
  { 
    label: 'Inventory', icon: Warehouse,
    children: [
      { label: 'Inventory Overview', path: '/stock/overview', icon: Package },
      { label: 'Stock Movements', path: '/stock/movements', icon: ArrowRightLeft },
      { label: 'Wastage', path: '/stock/wastage', icon: Trash2 },
      { label: 'Par Levels', path: '/stock/par-levels', icon: Gauge },
      { label: 'Pack Compositions', path: '/purchasing/pack-bom', icon: Box },
    ]
  },
  { label: 'Shopify Sync', path: '/shopify', icon: ShoppingCart, settingsOnly: true },

  { 
    label: 'Reports', icon: FileText,
    children: [
      { label: 'Audit & Runs', path: '/reports', icon: FileText },
      { label: 'Team Performance', path: '/reports/team', icon: Users },
      { label: 'Trend Forecasting', path: '/reports/forecasting', icon: TrendingUp },
    ]
  },
  { label: 'Equipment', path: '/equipment', icon: Wrench },
  { 
    label: 'Floor', icon: Warehouse,
    children: [
      { label: 'Production Pick', path: '/floor/pick', icon: PackageCheck },
      { label: 'Order Packing', path: '/floor/pack', icon: Box },
      { label: 'Production Tasks', path: '/floor/tasks', icon: UtensilsCrossed },
      { label: 'Stock Count', path: '/floor/stock-take', icon: ClipboardCheck },
      { label: 'Transfer Stock', path: '/floor/transfer', icon: ArrowLeftRight },
      { label: 'Receive Stock', path: '/floor/receive', icon: Truck },
      { label: 'Quick Scan', path: '/floor/scan', icon: Barcode },
    ]
  },
  { label: 'Bugs', path: '/bugs', icon: Bug },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user } = useAuth();
  const location = useLocation();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const isAdmin = user?.role === 'admin';

  /** Check if a nav path is allowed for the current user */
  const isAllowed = (path) => {
    if (isAdmin) return true;
    const permKey = PATH_PERMISSION_MAP[path];
    if (!permKey) return true; // no restriction
    return !!perms[permKey];
  };

  /** Filter nav items based on permissions */
  const filteredNavItems = navItems
    .map(item => {
      if (item.children) {
        const allowedChildren = item.children.filter(c => isAllowed(c.path));
        if (allowedChildren.length === 0) return null;
        return { ...item, children: allowedChildren };
      }
      if (item.path && !isAllowed(item.path)) return null;
      return item;
    })
    .filter(Boolean);

  const [openSections, setOpenSections] = useState(() => {
    // Auto-open sections based on current path
    const sections = {};
    navItems.forEach(item => {
      if (item.children) {
        const isChildActive = item.children.some(c => location.pathname === c.path);
        if (isChildActive) sections[item.label] = true;
      }
    });
    return sections;
  });

  const toggleSection = (label) => {
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 z-50",
      collapsed ? "w-16" : "w-60"
    )}>
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground font-bold text-sm">LL</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-sidebar-foreground leading-tight">Lean Living</h1>
              <p className="text-[10px] text-sidebar-foreground/40 tracking-wider uppercase leading-tight">Production</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center mx-auto shadow-sm">
            <span className="text-primary-foreground font-bold text-sm">LL</span>
          </div>
        )}
      </div>

      {/* Quick search hint */}
      {!collapsed && (
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
          }}
          className="mx-3 mt-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/50 text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors text-xs"
        >
          <Search className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] font-mono bg-sidebar-accent px-1 py-0.5 rounded-sm">⌘K</kbd>
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {filteredNavItems.filter(item => !item.settingsOnly).map((item) => {
          if (item.children) {
            const isOpen = openSections[item.label];
            const isChildActive = item.children.some(c => location.pathname === c.path);

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleSection(item.label)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full",
                    isChildActive
                      ? "text-sidebar-primary"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <item.icon className={cn("w-5 h-5 shrink-0", isChildActive && "text-sidebar-primary")} strokeWidth={1.5} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
                    </>
                  )}
                </button>
                {!collapsed && isOpen && (
                  <div className="ml-4 pl-4 border-l border-sidebar-border space-y-0.5 mt-0.5 mb-1">
                    {item.children.map(child => {
                      const isActive = location.pathname === child.path;
                      return (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-primary"
                              : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                          )}
                        >
                          <child.icon className={cn("w-4 h-4 shrink-0", isActive && "text-sidebar-primary")} strokeWidth={1.5} />
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const isActive = location.pathname === item.path || 
            (item.path !== '/' && item.path.length > 1 && location.pathname.startsWith(item.path + '/'));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all relative",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-primary" 
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-sidebar-primary" />}
              <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")} strokeWidth={1.5} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Dark mode + Collapse toggle */}
      <div className="border-t border-sidebar-border">
        <div className="px-2 py-1">
          <DarkModeToggle collapsed={collapsed} />
        </div>
        <button
          onClick={onToggle}
          className="flex items-center justify-center h-10 w-full text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}