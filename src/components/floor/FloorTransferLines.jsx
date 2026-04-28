import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mobile line items for stock transfer — shows added products with qty inputs.
 */
export default function FloorTransferLines({ lines, onQtyChange, onRemove }) {
  if (lines.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Scan or search to add products
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {lines.length} item{lines.length !== 1 ? 's' : ''} to transfer
      </p>
      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {lines.map((line, idx) => (
          <div key={line.product.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{line.product.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{line.product.sku} · {line.product.stock_uom}</p>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={line.qty}
              onChange={e => onQtyChange(idx, e.target.value)}
              placeholder="Qty"
              className="h-10 w-24 text-center text-lg font-bold"
              min="0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(idx)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}