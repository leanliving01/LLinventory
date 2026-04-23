import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, RotateCcw, Utensils, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DISPOSITIONS = [
  { value: 'reuse_tomorrow', label: 'Reuse Tomorrow', icon: RotateCcw, color: 'text-blue-600' },
  { value: 'replate_today', label: 'Re-plate Today', icon: Utensils, color: 'text-green-600' },
  { value: 'waste', label: 'Record as Waste', icon: Trash2, color: 'text-red-600' },
];

/**
 * §5.1.6 Surplus Handling
 * End-of-run surplus disposition: Reuse Tomorrow / Re-plate Today / Waste
 */
export default function SurplusModal({ surplusLines, onConfirm, onCancel, loading }) {
  const [dispositions, setDispositions] = useState({});

  const handleChange = (lineId, value) => {
    setDispositions(prev => ({ ...prev, [lineId]: value }));
  };

  const allAssigned = surplusLines.every(l => dispositions[l.id]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground">Surplus Handling</h2>
            <p className="text-xs text-muted-foreground">
              {surplusLines.length} item{surplusLines.length !== 1 ? 's' : ''} produced more than planned — choose what to do with the surplus.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {surplusLines.map(line => {
            const surplus = line.surplus;
            const disposition = dispositions[line.id];
            return (
              <div key={line.id} className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{line.product_name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
                  </div>
                  <Badge className="bg-green-100 text-green-700 font-mono">+{surplus} surplus</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DISPOSITIONS.map(d => {
                    const Icon = d.icon;
                    const isSelected = disposition === d.value;
                    return (
                      <button
                        key={d.value}
                        onClick={() => handleChange(line.id, d.value)}
                        className={cn(
                          "flex flex-col items-center gap-1 py-3 px-2 rounded-lg border-2 transition-all text-center",
                          isSelected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                        )}
                      >
                        <Icon className={cn("w-5 h-5", d.color)} />
                        <span className="text-[11px] font-medium">{d.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onCancel}>Skip</Button>
          <Button onClick={() => onConfirm(dispositions)} disabled={!allAssigned || loading}>
            {loading ? 'Processing...' : 'Confirm Dispositions'}
          </Button>
        </div>
      </div>
    </div>
  );
}