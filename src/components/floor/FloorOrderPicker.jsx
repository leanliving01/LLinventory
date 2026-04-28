import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShoppingBag, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Displays paid/unfulfilled orders for packing selection.
 */
export default function FloorOrderPicker({ orders, loading, onSelect }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading orders...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-bold">No Orders to Pack</h2>
        <p className="text-sm text-muted-foreground">
          All paid orders have been packed. Check again later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Select Order to Pack</h1>
      <p className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''} ready</p>
      <div className="space-y-3">
        {orders.slice(0, 15).map(order => (
          <button
            key={order.id}
            onClick={() => onSelect(order)}
            className="w-full bg-card border-2 border-border rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-transform text-left hover:border-primary/50"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base">{order.order_number || order.shopify_order_id}</p>
              <p className="text-sm text-muted-foreground truncate">{order.customer_name || 'Customer'}</p>
              <p className="text-xs text-muted-foreground">
                {order.order_date ? format(new Date(order.order_date), 'dd MMM HH:mm') : '—'}
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-700 text-xs shrink-0">Pack</Badge>
          </button>
        ))}
        {orders.length > 15 && (
          <p className="text-xs text-muted-foreground text-center">Showing 15 of {orders.length}</p>
        )}
      </div>
    </div>
  );
}