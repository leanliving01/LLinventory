import React, { useMemo } from 'react';
import { differenceInDays, format } from 'date-fns';
import { Truck, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * Overdue POs — expected_date in the past and not received/cancelled.
 * Separate from the general "open POs" table.
 */
export default function OverduePOsTable({ purchaseOrders }) {
  const overduePOs = useMemo(() => {
    const now = new Date();
    return purchaseOrders
      .filter(po => {
        if (['received', 'paid', 'cancelled'].includes(po.status)) return false;
        if (!po.expected_date) return false;
        return new Date(po.expected_date) < now;
      })
      .map(po => {
        const daysOverdue = differenceInDays(now, new Date(po.expected_date));
        return { ...po, daysOverdue };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 8);
  }, [purchaseOrders]);

  if (overduePOs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Overdue Purchase Orders</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-status-good-subtle flex items-center justify-center mx-auto mb-2">
            <Truck className="w-5 h-5 text-status-good" strokeWidth={1.5} />
          </div>
          No overdue POs — all on track
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-status-bad" />
        Overdue Purchase Orders
      </h3>
      <div className="space-y-1">
        {overduePOs.map(po => (
          <div key={po.id} className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md bg-status-bad-subtle flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4 text-status-bad" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{po.po_number}</p>
                <p className="text-[11px] text-muted-foreground">{po.supplier_name || '—'}</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-2 flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold tabular-nums">R {(po.total || 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">
                  Due: {format(new Date(po.expected_date), 'dd MMM')}
                </p>
              </div>
              <Badge className="text-[10px] tabular-nums bg-status-bad-subtle text-status-bad">
                {po.daysOverdue}d late
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}