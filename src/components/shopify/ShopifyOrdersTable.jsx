import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';

const statusColors = {
  paid: 'bg-emerald-100 text-emerald-700',
  unpaid: 'bg-red-100 text-red-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  refunded: 'bg-gray-100 text-gray-700',
};

const fulfilmentColors = {
  unfulfilled: 'bg-amber-100 text-amber-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-blue-100 text-blue-700',
  restocked: 'bg-gray-100 text-gray-700',
};

const mealColumns = [
  { key: 'mwl_meals', label: 'MWL', color: 'text-blue-700' },
  { key: 'wwl_meals', label: 'WWL', color: 'text-pink-700' },
  { key: 'mlm_meals', label: 'MLM', color: 'text-green-700' },
  { key: 'wlm_meals', label: 'WLM', color: 'text-orange-700' },
  { key: 'lc_meals', label: 'LC', color: 'text-amber-700' },
  { key: 'byo_meals', label: 'BYO', color: 'text-purple-700' },
];

export default function ShopifyOrdersTable({ orders }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Order #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Customer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fulfilment</th>
              {mealColumns.map(col => (
                <th key={col.key} className="text-center px-3 py-3 text-xs font-bold uppercase tracking-wide">
                  <span className={col.color}>{col.label}</span>
                </th>
              ))}
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Total</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Demand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No orders match the current filters</p>
                </td>
              </tr>
            ) : orders.map(order => (
              <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-sm font-medium">{order.order_number}</td>
                <td className="px-4 py-2.5 text-sm">{order.customer_name || '—'}</td>
                <td className="px-4 py-2.5 text-sm text-muted-foreground">
                  {order.order_date ? format(new Date(order.order_date), 'dd MMM yyyy') : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.paid_status] || ''}`}>
                    {order.paid_status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${fulfilmentColors[order.fulfilment_status] || ''}`}>
                    {order.fulfilment_status}
                  </span>
                </td>
                {mealColumns.map(col => {
                  const val = order[col.key] || 0;
                  return (
                    <td key={col.key} className="px-3 py-2.5 text-center">
                      {val > 0 ? (
                        <span className={`text-sm font-semibold tabular-nums ${col.color}`}>{val}</span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">
                  {order.total_meals || '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {order.demand_calculated ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Done</span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}