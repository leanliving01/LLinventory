import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, PackagePlus, Loader2, AlertTriangle } from 'lucide-react';

/**
 * Modal that lets staff pick a shortage qty to produce.
 * Creates a stock deduction (pick from storage) and adds a task to the shortage run.
 */
export default function ShortagePickModal({ item, onConfirm, onCancel, loading }) {
  const [pickQty, setPickQty] = useState(String(Math.abs(item.variance)));
  const qty = Number(pickQty) || 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-red-50 dark:bg-red-900/20 rounded-t-2xl">
          <div>
            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Pick Shortage</h3>
            <p className="text-sm text-muted-foreground">{item.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-4">
          {/* Shortage summary */}
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Planned</p>
                <p className="text-sm font-bold">{item.totalPlanned} {item.uom}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Actual</p>
                <p className="text-sm font-bold">{item.totalActual} {item.uom}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Short</p>
                <p className="text-sm font-bold text-red-600">{Math.abs(item.variance)} {item.uom}</p>
              </div>
            </div>
          </div>

          {/* Pick quantity input */}
          <div>
            <label className="text-sm font-semibold mb-2 block">
              How much are you picking from storage?
            </label>
            <div className="flex items-center gap-3">
              <Input
                type="text"
                inputMode="decimal"
                value={pickQty}
                onChange={e => setPickQty(e.target.value)}
                className="h-14 text-2xl font-bold text-right flex-1"
                autoFocus
              />
              <span className="text-sm text-muted-foreground font-medium">{item.uom}</span>
            </div>
            {qty > Math.abs(item.variance) && (
              <div className="flex items-center gap-2 mt-2 text-amber-600">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p className="text-xs">Picking more than the shortage amount</p>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            This will deduct <strong>{qty} {item.uom}</strong> of <strong>{item.name}</strong> from storage 
            and create a {item.station} task in the shortage production run.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1 h-12 gap-2 bg-red-600 hover:bg-red-700 text-white"
            onClick={() => onConfirm(qty)}
            disabled={loading || qty <= 0}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
            Pick & Create Task
          </Button>
        </div>
      </div>
    </div>
  );
}