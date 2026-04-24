import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { differenceInDays, format } from 'date-fns';
import { FileText } from 'lucide-react';

export default function POAgingTable({ purchaseOrders }) {
  const openPOs = useMemo(() => {
    return purchaseOrders
      .filter(po => ['confirmed', 'partially_received', 'received', 'invoiced'].includes(po.status) && po.payment_status !== 'paid')
      .map(po => {
        const age = po.order_date ? differenceInDays(new Date(), new Date(po.order_date)) : 0;
        return { ...po, age };
      })
      .sort((a, b) => b.age - a.age)
      .slice(0, 8);
  }, [purchaseOrders]);

  if (openPOs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Open Purchase Orders</h3>
        <div className="text-center py-10 text-muted-foreground text-sm">
          <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          No open purchase orders
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Open Purchase Orders</h3>
      <div className="space-y-2">
        {openPOs.map(po => (
          <div key={po.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <div>
              <p className="text-sm font-medium">{po.po_number}</p>
              <p className="text-[10px] text-muted-foreground">{po.supplier_name || '—'}</p>
            </div>
            <div className="text-right flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold">R {(po.total || 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{po.age}d old</p>
              </div>
              <Badge className={`text-[10px] ${
                po.age > 30 ? 'bg-red-100 text-red-700' :
                po.age > 14 ? 'bg-amber-100 text-amber-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {po.status.replace('_', ' ')}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}