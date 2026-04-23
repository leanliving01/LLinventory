import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function StockTakeVarianceReport({ data, onClose }) {
  const adjustments = data.filter(r => r.variance !== 0);
  const noChange = data.filter(r => r.variance === 0);
  const totalPositive = adjustments.filter(r => r.variance > 0).reduce((s, r) => s + r.variance, 0);
  const totalNegative = adjustments.filter(r => r.variance < 0).reduce((s, r) => s + r.variance, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Stock Take Variance Report</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{format(new Date(), 'dd MMM yyyy HH:mm')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
          <Printer className="w-4 h-4" /> Print
        </Button>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Products Counted</p>
          <p className="text-lg font-bold">{data.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Adjustments</p>
          <p className="text-lg font-bold text-amber-600">{adjustments.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Surplus</p>
          <p className="text-lg font-bold text-green-600">+{totalPositive}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Shortage</p>
          <p className="text-lg font-bold text-red-600">{totalNegative}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">No Change</p>
          <p className="text-lg font-bold text-muted-foreground">{noChange.length}</p>
        </div>
      </div>

      {/* Adjustments table */}
      {adjustments.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">Adjustments Made ({adjustments.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Product</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">UoM</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">System</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Counted</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adjustments.sort((a, b) => a.variance - b.variance).map(row => (
                  <tr key={row.product_id}>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.product_sku}</td>
                    <td className="px-4 py-2 font-medium">{row.product_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.uom}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.system_qty}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{row.counted_qty}</td>
                    <td className="px-4 py-2 text-right">
                      <Badge className={cn(
                        "font-mono",
                        row.variance > 0 && "bg-green-100 text-green-700",
                        row.variance < 0 && "bg-red-100 text-red-700",
                      )}>
                        {row.variance > 0 ? '+' : ''}{row.variance}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adjustments.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-8 text-center">
          <p className="text-green-700 font-medium">All counts match the system — no adjustments needed.</p>
        </div>
      )}
    </div>
  );
}