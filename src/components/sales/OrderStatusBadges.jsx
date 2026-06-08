import React from 'react';
import { Badge } from '@/components/ui/badge';
import { deriveOrderBadges, channelLabels, channelColors } from '@/lib/salesOrderStatus';

/**
 * Renders the separate status badges for a sales order: operational/pack,
 * payment, fulfilment, refund/returns, cancellation — and optionally the
 * sales channel. Used by the list row, detail header, and inline expansion.
 *
 * Props:
 *   order            – the sales_orders row
 *   returnsCount     – number of linked returns (optional)
 *   refundLineCount  – number of financial refund lines (optional)
 *   showChannel      – also render the order_source channel badge
 *   size             – 'sm' | 'md'
 */
export default function OrderStatusBadges({
  order,
  returnsCount = 0,
  refundLineCount = 0,
  showChannel = false,
  size = 'md',
  className = '',
}) {
  if (!order) return null;
  const badges = deriveOrderBadges(order, { returnsCount, refundLineCount });
  const pad = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {showChannel && order.order_source && (
        <Badge
          variant="outline"
          className={`${pad} font-medium border ${channelColors[order.order_source] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
        >
          {channelLabels[order.order_source] || order.order_source}
        </Badge>
      )}
      {badges.map((b) => (
        <Badge key={b.key} variant="outline" className={`${pad} font-medium border ${b.className}`}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}
