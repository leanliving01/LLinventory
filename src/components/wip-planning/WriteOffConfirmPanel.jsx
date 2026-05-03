import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Loader2 } from 'lucide-react';

/**
 * Shows the list of declined batches and asks the user to confirm the bulk write-off.
 */
export default function WriteOffConfirmPanel({ declinedBatches, onConfirm, confirming }) {
  if (declinedBatches.length === 0) return null;

  const totalKg = declinedBatches.reduce((s, b) => s + (b.qty_kg || 0), 0);
  const totalValue = declinedBatches.reduce((s, b) => s + (b.qty_kg || 0) * (b.carrying_cost_per_kg || 0), 0);

  return (
    <div className="border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
          <Trash2 className="w-4 h-4" />
          {declinedBatches.length} batch{declinedBatches.length !== 1 ? 'es' : ''} to write off
        </h3>
        <div className="text-right text-xs">
          <span className="text-red-600 font-bold">{totalKg.toFixed(1)} kg</span>
          <span className="text-muted-foreground ml-2">R {totalValue.toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-1">
        {declinedBatches.map(b => (
          <div key={b.id} className="flex items-center justify-between text-xs bg-white/60 dark:bg-black/20 rounded-md px-3 py-1.5">
            <div>
              <span className="font-mono font-medium">{b.batch_number}</span>
              <span className="text-muted-foreground ml-2">{b.bulk_product_name}</span>
            </div>
            <div className="text-right">
              <span className="font-medium">{(b.qty_kg || 0).toFixed(1)} kg</span>
              <span className="text-muted-foreground ml-2">R {((b.qty_kg || 0) * (b.carrying_cost_per_kg || 0)).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="destructive"
        className="w-full gap-2 h-11"
        onClick={onConfirm}
        disabled={confirming}
      >
        {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        Confirm Write-Off ({totalKg.toFixed(1)} kg)
      </Button>
    </div>
  );
}