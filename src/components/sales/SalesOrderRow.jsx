import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

const lifecycleColors = {
  pending_payment: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paid_unfulfilled: 'bg-orange-100 text-orange-700 border-orange-200',
  fulfilled: 'bg-green-100 text-green-700 border-green-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  refunded: 'bg-purple-100 text-purple-700 border-purple-200',
};

const lifecycleLabels = {
  pending_payment: 'Pending Payment',
  paid_unfulfilled: 'Awaiting Fulfilment',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

function MealSummary({ lines }) {
  if (!lines || lines.length === 0) return <span className="text-muted-foreground text-xs">No items</span>;

  // Only show component/standalone lines (not package parents)
  const mealLines = lines.filter(l => !l.is_package_parent && l.status === 'active');
  const packageLines = lines.filter(l => l.is_package_parent);

  const parts = [];
  if (packageLines.length > 0) {
    parts.push(...packageLines.map(p => p.name || p.sku));
  }
  if (mealLines.length > 0) {
    const shown = mealLines.slice(0, 3);
    parts.push(...shown.map(l => `${l.qty}× ${l.name || l.sku}`));
    if (mealLines.length > 3) {
      parts.push(`+${mealLines.length - 3} more`);
    }
  }

  return <span className="text-xs text-muted-foreground">{parts.join(', ')}</span>;
}

export default function SalesOrderRow({ order }) {
  const [expanded, setExpanded] = useState(false);

  const { data: lines = [] } = useQuery({
    queryKey: ['sales-order-lines', order.id],
    queryFn: () => base44.entities.SalesOrderLine.filter({ sales_order_id: order.id }),
    enabled: true, // preload for summary
  });

  const orderDate = order.order_date ? new Date(order.order_date) : null;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {/* Order number */}
        <span className="font-semibold text-sm w-28 shrink-0">{order.order_number || order.shopify_order_id}</span>

        {/* Customer */}
        <span className="text-sm w-40 truncate shrink-0">{order.customer_name || '—'}</span>

        {/* Date + Time */}
        <span className="text-sm text-muted-foreground w-36 shrink-0">
          {orderDate ? format(orderDate, 'dd MMM yyyy HH:mm') : '—'}
        </span>

        {/* Status */}
        <Badge className={`text-[11px] shrink-0 ${lifecycleColors[order.lifecycle_state] || ''}`}>
          {lifecycleLabels[order.lifecycle_state] || order.lifecycle_state}
        </Badge>

        {/* Amount */}
        <span className="text-sm font-medium w-24 text-right shrink-0 ml-auto">
          R{(order.total_amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
        </span>

        {/* Compact meal summary */}
        <span className="hidden xl:block flex-1 truncate ml-3">
          <MealSummary lines={lines} />
        </span>
      </button>

      {/* Expanded line details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-muted/30">
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-xs">No line items</td></tr>
                )}
                {lines.map(line => (
                  <tr key={line.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                    <td className="px-3 py-2">
                      {line.name}
                      {line.is_package_parent && (
                        <Badge variant="outline" className="ml-2 text-[10px] py-0">Package</Badge>
                      )}
                      {line.is_package_component && (
                        <Badge variant="outline" className="ml-2 text-[10px] py-0 border-blue-200 text-blue-600">Component</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{line.qty}</td>
                    <td className="px-3 py-2 text-right">
                      {line.unit_price ? `R${line.unit_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {line.line_total ? `R${line.line_total.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-muted-foreground capitalize">
                        {(line.line_type || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Order metadata */}
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
            {order.customer_email && <span>Email: {order.customer_email}</span>}
            {order.customer_phone && <span>Phone: {order.customer_phone}</span>}
            {order.shipping_city && <span>City: {order.shipping_city}</span>}
            {order.tags && <span>Tags: {order.tags.replace(/\|/g, ', ')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}