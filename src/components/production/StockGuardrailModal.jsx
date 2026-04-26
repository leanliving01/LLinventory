import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, X, ArrowLeft } from 'lucide-react';

/**
 * §5.1.8 Not-Enough-Stock Guardrail
 * Shows shortages. User can go back to fix, or override to start anyway
 * (e.g. when they know they have the stock but it hasn't been received in the system yet).
 */
export default function StockGuardrailModal({ shortages, onCancel, onOverride }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-destructive/30 bg-red-50 dark:bg-red-900/10 rounded-t-xl">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-red-700 dark:text-red-400">Insufficient Stock</h2>
            <p className="text-xs text-red-600/80">{shortages.length} ingredient{shortages.length !== 1 ? 's' : ''} below required quantity</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-sm text-muted-foreground mb-3">
            The following ingredients show as short in the system. You can go back to receive stock first, or start anyway if you know the stock is available.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 font-medium text-muted-foreground">Ingredient</th>
                <th className="text-right py-2 font-medium text-muted-foreground">Needed</th>
                <th className="text-right py-2 font-medium text-muted-foreground">Available</th>
                <th className="text-right py-2 font-medium text-muted-foreground">Short</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shortages.map((s, i) => (
                <tr key={i}>
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2 text-right tabular-nums">{s.needed} {s.uom}</td>
                  <td className="py-2 text-right tabular-nums">{s.available} {s.uom}</td>
                  <td className="py-2 text-right">
                    <Badge className="bg-red-100 text-red-700 font-mono">-{s.short} {s.uom}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <Button onClick={onCancel} variant="outline" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Button>
          <Button onClick={onOverride} variant="destructive" className="gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Start Anyway
          </Button>
        </div>
      </div>
    </div>
  );
}