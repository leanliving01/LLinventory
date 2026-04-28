import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, ChevronRight, Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mobile-optimised count list for stock take.
 * Renders products grouped by pick_category (or product type).
 * Each row shows product name, system qty, and a large count input.
 */
export default function FloorCountList({ products, stockMap, counts, onCountChange, groupMap }) {
  const [expanded, setExpanded] = useState({});

  // Group by groupMap (package-based) if provided, else by pick_category or type
  const groups = {};
  products.forEach(p => {
    const cat = (groupMap && p.sku && groupMap[p.sku])
      ? groupMap[p.sku]
      : (p.pick_category || p.type || 'Other');
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  const sortedCategories = Object.keys(groups).sort();

  return (
    <div className="space-y-3">
      {sortedCategories.map(cat => {
        const items = groups[cat];
        const isOpen = expanded[cat] !== false; // default open
        const countedInCat = items.filter(p => counts[p.id] !== undefined && counts[p.id] !== '').length;

        return (
          <div key={cat} className="bg-card border border-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [cat]: !isOpen }))}
              className="w-full flex items-center justify-between px-4 py-3 active:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <span className="font-semibold text-sm">{cat}</span>
              </div>
              <Badge variant={countedInCat === items.length ? 'default' : 'outline'} className="text-xs">
                {countedInCat}/{items.length}
              </Badge>
            </button>

            {isOpen && (
              <div className="divide-y divide-border">
                {items.map(product => {
                  const systemQty = stockMap[product.id]?.qty_on_hand || 0;
                  const counted = counts[product.id];
                  const isCounted = counted !== undefined && counted !== '';

                  return (
                    <div key={product.id} className={cn("px-4 py-3", isCounted && "bg-green-50/50 dark:bg-green-900/10")}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{product.sku} · System: {systemQty} {product.stock_uom}</p>
                        </div>
                        {isCounted && <Check className="w-5 h-5 text-green-600 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => {
                            const current = Number(counted) || 0;
                            if (current > 0) onCountChange(product.id, String(current - 1));
                          }}
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={counted ?? ''}
                          onChange={e => onCountChange(product.id, e.target.value)}
                          placeholder="—"
                          className="h-10 text-center text-lg font-bold flex-1"
                          min="0"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => {
                            const current = Number(counted) || 0;
                            onCountChange(product.id, String(current + 1));
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}