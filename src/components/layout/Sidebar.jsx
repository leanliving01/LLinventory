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
  Plus,
  ClipboardCheck,
  Calculator,
  UtensilsCrossed,
  Barcode,
  Gauge,
  Box,
  List
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Catalog', path: '/catalog', icon: Package },
  { label: 'Production Plan', path: '/production', icon: Factory },
  { 
    label: 'Inventory', icon: Warehouse,
    children: [
      { label: 'New Production', path: '/stock/new-production', icon: Plus },
      { label: 'Stock Take', path: '/stock/stock-take', icon: ClipboardCheck },
    ]
  },
  { label: 'Shopify Sync', path: '/shopify', icon: ShoppingCart },
  { label: 'Demand Audit', path: '/demand', icon: Calculator },
  { 
    label: 'Master Data', icon: List,
    children: [
      { label: 'Meals', path: '/master-data/meals', icon: UtensilsCrossed },
      { label: 'SKUs', path: '/master-data/skus', icon: Barcode },
      { label: 'Par Levels', path: '/master-data/par-levels', icon: Gauge },
      { label: 'Packages', path: '/master-data/packages', icon: Box },
      { label: 'Recipes', path: '/master-data/bom', icon: ClipboardCheck },
    ]
  },
  { label: 'Reports', path: '/reports', icon: FileText },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();
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
      <div className="flex items-center h-16 px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">LL</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-sidebar-foreground">Lean Living</h1>
              <p className="text-[10px] text-sidebar-foreground/50 tracking-wider uppercase">Production</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <span className="text-primary-foreground font-bold text-sm">LL</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
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
                  <item.icon className={cn("w-5 h-5 shrink-0", isChildActive && "text-sidebar-primary")} />
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
                            "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-primary"
                              : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                          )}
                        >
                          <child.icon className={cn("w-4 h-4 shrink-0", isActive && "text-sidebar-primary")} />
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
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-primary" 
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}