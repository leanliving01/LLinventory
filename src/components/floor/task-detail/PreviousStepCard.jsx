import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowDown } from 'lucide-react';

const STATION_LABELS = { prep: 'Prep Step', cook: 'Cook Step' };

/**
 * Shows "From Previous Step" availability card.
 * Used in ConsumeTab, FloorTaskDetail header, and TaskCompletionModal.
 *
 * @param {{ previousStation: string, items: Array<{ productName, productSku, uom, requiredQty, availableQty }> }} props
 */
export default function PreviousStepCard({ previousStation, items, compact = false }) {
  if (!items || items.length === 0) return null;

  const label = STATION_LABELS[previousStation] || 'Previous Step';

  if (compact) {
    // Compact mode for completion modal — single-line per item
    return (
      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <ArrowDown className="w-3 h-3 text-blue-600" />
          <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">From {label}</p>
        </div>
        {items.map((item, i) => (
          <div key={i}>
            {items.length > 1 && <p className="text-xs font-semibold mt-1">{item.productName}</p>}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Required (recipe):</span>
              <span className="font-bold tabular-nums">{fmtQty(item.requiredQty)} {item.uom}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Available from {previousStation}:</span>
              <span className="font-bold tabular-nums text-blue-600">{fmtQty(item.availableQty)} {item.uom}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Full mode for ConsumeTab
  return (
    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowDown className="w-4 h-4 text-blue-600" />
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
          From {label}
        </p>
      </div>
      {items.map((item, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-sm">{item.productName}</p>
              {item.productSku && <p className="text-xs font-mono text-muted-foreground">{item.productSku}</p>}
            </div>
            <Badge variant="outline" className="text-[10px]">{item.uom}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Required (recipe)</span>
              <span className="text-lg font-bold tabular-nums">{fmtQty(item.requiredQty)}</span>
              <span className="text-xs text-muted-foreground ml-1">{item.uom}</span>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Available from {previousStation}</span>
              <span className="text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">{fmtQty(item.availableQty)}</span>
              <span className="text-xs text-muted-foreground ml-1">{item.uom}</span>
            </div>
          </div>
          {item.availableQty > item.requiredQty && (
            <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
              +{(item.availableQty - item.requiredQty).toFixed(2)} {item.uom} extra — you can use more or set aside the surplus
            </p>
          )}
          {item.availableQty < item.requiredQty && (
            <p className="text-[11px] font-medium text-amber-600">
              {(item.requiredQty - item.availableQty).toFixed(2)} {item.uom} short — yield was lower than planned
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function fmtQty(v) {
  if (v == null) return '—';
  return Number.isInteger(v) ? v : Number(v).toFixed(2);
}