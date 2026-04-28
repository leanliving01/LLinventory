import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ShortageTable({ items = [] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Low Stock</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-status-good-subtle flex items-center justify-center mx-auto mb-2">
            <AlertTriangle className="w-5 h-5 text-status-good" strokeWidth={1.5} />
          </div>
          All stock levels healthy
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Low Stock</h3>
      <div className="space-y-1">
        {items.slice(0, 8).map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md bg-status-bad-subtle flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-status-bad">{(item.sku_code || '?')[0]}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.meal_name}</p>
                <p className="text-[11px] font-mono text-muted-foreground">{item.sku_code}</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-2">
              <p className="text-sm font-semibold tabular-nums text-status-bad">-{item.shortage}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">below par</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}