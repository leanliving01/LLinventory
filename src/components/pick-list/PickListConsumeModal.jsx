import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Save, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * After pick list is confirmed, this modal lets the user enter the ACTUAL consumed
 * qty for each ingredient. Difference between picked and consumed = returned to stock.
 */
export default function PickListConsumeModal({ pickItems, pickedState, onConfirmConsumption, onCancel }) {
  // consumedQty: { [productId]: string }
  const [consumedQty, setConsumedQty] = useState(() => {
    const initial = {};
    pickItems.forEach(item => {
      // Default consumed = needed (not picked)
      initial[item.product.id] = String(item.totalQty);
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (pid, val) => {
    setConsumedQty(prev => ({ ...prev, [pid]: val }));
  };

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirmConsumption(consumedQty);
    setSaving(false);
  };

  // Summary stats
  const totalItems = pickItems.length;
  const itemsWithSurplus = pickItems.filter(item => {
    const picked = Number(pickedState[item.product.id]?.qty) || item.totalQty;
    const consumed = Number(consumedQty[item.product.id]) || 0;
    return picked > consumed;
  }).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold">Confirm Consumed Quantities</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              You picked more than needed for some items. Enter what was actually used — the rest goes back to stock.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left py-2 font-medium">Ingredient</th>
                <th className="text-right py-2 font-medium w-20">Needed</th>
                <th className="text-right py-2 font-medium w-20">Picked</th>
                <th className="text-center py-2 font-medium w-28">Consumed</th>
                <th className="text-right py-2 font-medium w-20">Surplus</th>
                <th className="text-left py-2 font-medium w-12">UoM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pickItems.map(item => {
                const pid = item.product.id;
                const pickedVal = Number(pickedState[pid]?.qty) || item.totalQty;
                const consumedVal = Number(consumedQty[pid]) || 0;
                const surplus = pickedVal - consumedVal;
                const hasSurplus = surplus > 0.001;
                const overConsumed = consumedVal > pickedVal;

                return (
                  <tr key={pid} className={cn(
                    hasSurplus && 'bg-blue-50/40 dark:bg-blue-950/10',
                    overConsumed && 'bg-red-50/40 dark:bg-red-950/10'
                  )}>
                    <td className="py-2">
                      <p className="font-medium text-sm">{item.product.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{item.product.sku}</p>
                    </td>
                    <td className="py-2 text-right tabular-nums">{item.totalQty.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{pickedVal.toLocaleString()}</td>
                    <td className="py-2 text-center">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={consumedQty[pid]}
                        onChange={e => handleChange(pid, e.target.value)}
                        className={cn(
                          "w-24 h-8 text-right text-sm mx-auto tabular-nums",
                          overConsumed && "border-red-400 ring-1 ring-red-300"
                        )}
                      />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {hasSurplus ? (
                        <span className="text-blue-600 font-medium">+{surplus.toFixed(2)}</span>
                      ) : overConsumed ? (
                        <span className="text-red-600 font-medium">{surplus.toFixed(2)}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">{item.uom}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {itemsWithSurplus > 0 && (
              <span className="text-blue-600 font-medium">{itemsWithSurplus} item(s) with surplus — will be returned to stock</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={saving} className="gap-1.5 bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Confirm Consumption
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}