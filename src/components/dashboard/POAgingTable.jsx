import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { differenceInDays } from 'date-fns';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import getKpiStatus, { STATUS_COLORS } from '@/lib/getKpiStatus';

export default function POAgingTable({ purchaseOrders }) {
  const openPOs = useMemo(() => {
    return purchaseOrders
      .filter(po => ['draft', 'confirmed', 'partially_received'].includes(po.status))
      .map(po => {
        const age = po.order_date ? differenceInDays(new Date(), new Date(po.order_date)) : 0;
        const ageStatus = age > 30 ? 'bad' : age > 14 ? 'warn' : 'good';
        return { ...po, age, ageStatus };
      })
      .sort((a, b) => b.age - a.age)
      .slice(0, 8);
  }, [purchaseOrders]);

  if (openPOs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Open POs</h3>
        <div className="text-center py-10 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-status-good-subtle flex items-center justify-center mx-auto mb-2">
            <FileText className="w-5 h-5 text-status-good" strokeWidth={1.5} />
          </div>
          No open purchase orders
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Open POs</h3>
      <div className="space-y-1">
        {openPOs.map(po => {
          const colors = STATUS_COLORS[po.ageStatus];
          return (
            <div key={po.id} className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-8 h-8 rounded-md flex items-center justify-center shrink-0", colors.bg)}>
                  <FileText className={cn("w-4 h-4", colors.icon)} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{po.po_number}</p>
                  <p className="text-[11px] text-muted-foreground">{po.supplier_name || '—'}</p>
                </div>
              </div>
              <div className="text-right flex items-center gap-3 shrink-0">
                <div>
                  <p className="text-sm font-semibold tabular-nums">R {(po.total || 0).toLocaleString()}</p>
                  <p className={cn("text-[10px] tabular-nums font-medium", colors.text)}>{po.age}d old</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}