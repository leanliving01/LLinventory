import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';

/**
 * Mobile line items for receiving stock — shows product, qty, and optional unit cost.
 */
export default function FloorReceiveLines({ lines, onQtyChange, onCostChange, onRemove }) {
  if (lines.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Scan or search to add items being received
      </div>
    );
  }

  const totalValue = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {lines.length} item{lines.length !== 1 ? 's' : ''}
        </p>
        {totalValue > 0 && (
          <Badge variant="outline" className="text-xs">
            Total: R {totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Badge>
        )}
      </div>
      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {lines.map((line, idx) => (
          <div key={line.product.id} className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{line.product.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{line.product.sku} · {line.product.stock_uom}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(idx)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Qty</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={line.qty}
                  onChange={e => onQtyChange(idx, e.target.value)}
                  placeholder="0"
                  className="h-10 text-center text-lg font-bold"
                  min="0"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground uppercase font-semibold">Unit Cost (R)</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={line.unit_cost}
                  onChange={e => onCostChange(idx, e.target.value)}
                  placeholder="0.00"
                  className="h-10 text-center text-base"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}