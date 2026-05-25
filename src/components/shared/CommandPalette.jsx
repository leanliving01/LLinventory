import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingCart, Factory, Warehouse, FileText,
  Settings, CookingPot, Users, Truck, PlayCircle, Wrench, Search,
  TrendingUp, ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, category: 'Navigate' },
  { label: 'Products', path: '/catalog', icon: Package, category: 'Navigate' },
  { label: 'Bill of Materials', path: '/recipes', icon: CookingPot, category: 'Navigate' },
  { label: 'Suppliers', path: '/suppliers', icon: Truck, category: 'Navigate' },
  { label: 'Purchase Orders', path: '/purchasing/orders', icon: FileText, category: 'Navigate' },
  { label: 'Sales', path: '/sales', icon: ShoppingCart, category: 'Navigate' },
  { label: 'Production Plan', path: '/production', icon: Factory, category: 'Navigate' },
  { label: 'Production Runs', path: '/production/runs', icon: PlayCircle, category: 'Navigate' },
  { label: 'Receive Stock', path: '/stock/receive', icon: Warehouse, category: 'Navigate' },
  { label: 'Transfer Stock', path: '/stock/transfer', icon: Warehouse, category: 'Navigate' },
  { label: 'Stock Take', path: '/stock/stock-take', icon: Warehouse, category: 'Navigate' },
  { label: 'Wastage', path: '/stock/wastage', icon: Warehouse, category: 'Navigate' },
  { label: 'Par Levels', path: '/stock/par-levels', icon: TrendingUp, category: 'Navigate' },
  { label: 'Reports', path: '/reports', icon: FileText, category: 'Navigate' },
  { label: 'Customers', path: '/customers', icon: Users, category: 'Navigate' },
  { label: 'Equipment', path: '/equipment', icon: Wrench, category: 'Navigate' },
  { label: 'Settings', path: '/settings', icon: Settings, category: 'Navigate' },
  { label: 'Shopify Sync', path: '/shopify', icon: ShoppingCart, category: 'Navigate' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Cmd/Ctrl+K to open
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return NAV_ITEMS;
    const q = query.toLowerCase();
    return NAV_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.path.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback((item) => {
    navigate(item.path);
    setOpen(false);
    setQuery('');
  }, [navigate]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      execute(filtered[selectedIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative mx-auto mt-[15vh] w-full max-w-[560px] bg-card border border-border rounded-lg shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'count-up 180ms ease-out' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, actions..."
            className="flex-1 h-12 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted rounded-sm border border-border font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.path}
                onClick={() => execute(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  i === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                )}
              >
                <item.icon className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
                <span className="text-[10px] text-muted-foreground">{item.category}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}