import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';

const PICK_CATEGORY_ORDER = [
  'Meats',
  'Vegetables',
  'Starches',
  'Spices & Seasoning',
  'Sauces & Condiments',
  'Dairy & Eggs',
  'Oils & Fats',
  'Dry Goods',
  'Packaging',
  'Other',
];

const CATEGORY_COLORS = {
  'Meats': 'bg-red-100 text-red-700',
  'Vegetables': 'bg-green-100 text-green-700',
  'Starches': 'bg-yellow-100 text-yellow-700',
  'Spices & Seasoning': 'bg-orange-100 text-orange-700',
  'Sauces & Condiments': 'bg-rose-100 text-rose-700',
  'Dairy & Eggs': 'bg-blue-100 text-blue-700',
  'Oils & Fats': 'bg-amber-100 text-amber-700',
  'Dry Goods': 'bg-stone-100 text-stone-700',
  'Packaging': 'bg-gray-100 text-gray-700',
  'Other': 'bg-slate-100 text-slate-700',
};

export default function RawMaterialGroupedTable({ products, showCheckbox, mergeSelection, setMergeSelection }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState({});

  const grouped = useMemo(() => {
    const groups = {};
    for (const p of products) {
      const cat = p.pick_category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    // Sort groups by defined order
    const sorted = [];
    for (const cat of PICK_CATEGORY_ORDER) {
      if (groups[cat]) sorted.push({ category: cat, items: groups[cat] });
    }
    // Any categories not in the predefined list
    for (const cat of Object.keys(groups)) {
      if (!PICK_CATEGORY_ORDER.includes(cat)) {
        sorted.push({ category: cat, items: groups[cat] });
      }
    }
    return sorted;
  }, [products]);

  const toggle = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Table header */}
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            {showCheckbox && <th className="w-10 px-3 py-3"></th>}
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Cost (ZAR)</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Price (ZAR)</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Inventory</th>
          </tr>
        </thead>
      </table>

      {grouped.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No raw materials match your filters.
        </div>
      )}

      {grouped.map(({ category, items }) => {
        const isCollapsed = collapsed[category];
        const colorClass = CATEGORY_COLORS[category] || 'bg-slate-100 text-slate-700';

        return (
          <div key={category}>
            {/* Category header row */}
            <button
              onClick={() => toggle(category)}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-y border-border hover:bg-muted/50 transition-colors text-left"
            >
              {isCollapsed
                ? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              }
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
                {category}
              </span>
              <span className="text-xs text-muted-foreground">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            </button>

            {/* Items table */}
            {!isCollapsed && (
              <table className="w-full">
                <tbody className="divide-y divide-border">
                  {items.map(p => {
                    const isSelected = mergeSelection?.includes(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                        onClick={() => navigate(`/catalog/${p.id}`)}
                      >
                        {showCheckbox && (
                          <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => setMergeSelection(prev =>
                                prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                              )}
                              className="rounded w-4 h-4"
                            />
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-sm font-mono font-medium">{p.sku}</td>
                        <td className="px-4 py-2.5 text-sm">{p.name}</td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.category || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                          {p.cost_avg ? `R ${p.cost_avg.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                          {p.price ? `R ${p.price.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-center">{p.stock_uom}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge className={p.inventory_tracked === false ? 'bg-gray-100 text-gray-500 text-[10px]' : 'bg-emerald-100 text-emerald-700 text-[10px]'}>
                            {p.inventory_tracked === false ? 'No' : 'Yes'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}