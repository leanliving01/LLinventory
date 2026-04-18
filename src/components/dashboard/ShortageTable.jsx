import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

export default function ShortageTable({ items = [] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Top Shortage SKUs</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          No shortages detected
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">Top Shortage SKUs</h3>
      <div className="space-y-3">
        {items.slice(0, 8).map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{item.meal_name}</p>
                <Badge variant="outline" className="text-[10px] mt-0.5">{item.package_type}</Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-red-600">-{item.shortage}</p>
              <p className="text-[10px] text-muted-foreground">below par</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}