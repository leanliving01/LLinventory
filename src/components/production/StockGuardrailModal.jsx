import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, X } from 'lucide-react';

/**
 * §5.1.8 Not-Enough-Stock Guardrail
 * Shows shortages before starting a run. User can proceed or cancel.
 */
export default function StockGuardrailModal({ shortages, onProceed, onCancel, loading }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground">Insufficient Stock Warning</h2>
            <p className="text-xs text-muted-foreground">{shortages.length} ingredient{shortages.length !== 1 ? 's' : ''} below required quantity</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
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

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onCancel}>Cancel — Don't Start</Button>
          <Button onClick={onProceed} disabled={loading} className="bg-amber-600 hover:bg-amber-700 gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {loading ? 'Starting...' : 'Start Anyway'}
          </Button>
        </div>
      </div>
    </div>
  );
}