import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { isToday, isTomorrow } from 'date-fns';
import { formatDateSAST } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export default function OrdersDueList({ orders }) {
  // Show paid unfulfilled orders, grouped by urgency
  const unfulfilled = orders
    .filter(o => o.paid_status === 'paid' && o.fulfilment_status === 'unfulfilled')
    .map(o => {
      const orderDate = o.order_date ? new Date(o.order_date) : null;
      return { ...o, orderDate };
    })
    .sort((a, b) => (a.orderDate || 0) - (b.orderDate || 0));

  const todayOrders = unfulfilled.filter(o => o.orderDate && isToday(o.orderDate));
  const tomorrowOrders = unfulfilled.filter(o => o.orderDate && isTomorrow(o.orderDate));
  const olderOrders = unfulfilled.filter(o => o.orderDate && !isToday(o.orderDate) && !isTomorrow(o.orderDate));

  if (unfulfilled.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Orders Awaiting Fulfilment</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-status-good-subtle flex items-center justify-center mx-auto mb-2">
            <ShoppingCart className="w-5 h-5 text-status-good" strokeWidth={1.5} />
          </div>
          All orders fulfilled
        </div>
      </div>
    );
  }

  const renderGroup = (label, items, variant) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge className={cn(
            "text-[10px] uppercase tracking-wider",
            variant === 'urgent' ? 'bg-status-bad-subtle text-status-bad' :
            variant === 'soon' ? 'bg-status-warn-subtle text-status-warn' :
            'bg-muted text-muted-foreground'
          )}>
            {label} ({items.length})
          </Badge>
        </div>
        {items.slice(0, 5).map(o => (
          <div key={o.id} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{o.order_number}</p>
              <p className="text-[11px] text-muted-foreground">{o.customer_name || '—'}</p>
            </div>
            <div className="text-right shrink-0 ml-2">
              <p className="text-sm font-semibold tabular-nums">{o.total_meals || 0} meals</p>
              <p className="text-[10px] text-muted-foreground">
                {o.orderDate ? formatDateSAST(o.orderDate) : '—'}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">
        Orders Awaiting Fulfilment
        <span className="text-xs font-normal text-muted-foreground ml-2">({unfulfilled.length} total)</span>
      </h3>
      <div className="space-y-3">
        {renderGroup('Today', todayOrders, 'urgent')}
        {renderGroup('Tomorrow', tomorrowOrders, 'soon')}
        {renderGroup('Older / Backlog', olderOrders, 'neutral')}
      </div>
    </div>
  );
}