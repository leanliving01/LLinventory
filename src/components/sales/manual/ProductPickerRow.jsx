import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { money } from '@/components/sales/order-shared/money';

/**
 * A single editable product line in the manual order form.
 *
 * Props:
 *   line        – { key, our_product_id, sku, name, qty, unit_price }
 *   available   – number | null  (sum of StockOnHand.qty_on_hand for the product)
 *   onChange(patch) – merge patch into the line
 *   onRemove()  – remove the line
 */
export default function ProductPickerRow({ line, available, onChange, onRemove }) {
  const qty = Number(line.qty) || 0;
  const price = Number(line.unit_price) || 0;
  const lineTotal = qty * price;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b last:border-b-0">
      <div className="min-w-[180px] flex-1">
        <p className="text-sm font-medium truncate">{line.name || 'Unnamed product'}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {line.sku || '—'}
          {available != null && (
            <span className="ml-2 text-muted-foreground/80">· {available} avail</span>
          )}
        </p>
      </div>

      <div className="w-20">
        <Input
          type="number"
          min="0"
          step="1"
          value={line.qty}
          onChange={e => onChange({ qty: e.target.value })}
          className="h-9 text-right"
          aria-label="Quantity"
        />
      </div>

      <div className="w-28">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={line.unit_price}
          onChange={e => onChange({ unit_price: e.target.value })}
          className="h-9 text-right"
          aria-label="Unit price"
        />
      </div>

      <div className="w-28 text-right text-sm font-medium tabular-nums">
        {money(lineTotal)}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Remove line"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
