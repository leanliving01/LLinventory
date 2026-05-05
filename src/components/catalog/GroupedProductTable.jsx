import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getProductSubcategory } from '@/lib/productSubcategories';

const GROUP_COLORS = [
  'bg-red-100 text-red-700',
  'bg-green-100 text-green-700',
  'bg-yellow-100 text-yellow-700',
  'bg-orange-100 text-orange-700',
  'bg-rose-100 text-rose-700',
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-stone-100 text-stone-700',
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-cyan-100 text-cyan-700',
  'bg-slate-100 text-slate-700',
];

export default function GroupedProductTable({ products, showCheckbox, mergeSelection, setMergeSelection }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({});

  const grouped = useMemo(() => {
    const groups = {};
    for (const p of products) {
      const cat = getProductSubcategory(p) || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    // Sort by group name, but put "Other" last
    return Object.entries(groups)
      .sort(([a], [b]) => {
        if (a.startsWith('Other')) return 1;
        if (b.startsWith('Other')) return -1;
        return a.localeCompare(b);
      })
      .map(([category, items]) => ({ category, items }));
  }, [products]);

  const toggle = (cat) => setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));

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
          No products match your filters.
        </div>
      )}

      {grouped.map(({ category, items }, groupIdx) => {
        const isOpen = expanded[category];
        const colorClass = GROUP_COLORS[groupIdx % GROUP_COLORS.length];

        return (
          <div key={category}>
            <button
              onClick={() => toggle(category)}
              className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-y border-border hover:bg-muted/50 transition-colors text-left"
            >
              {isOpen
                ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              }
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
                {category}
              </span>
              <span className="text-xs text-muted-foreground">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            </button>

            {isOpen && (
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